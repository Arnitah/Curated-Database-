-- Clay server-side sync for Cloudflare Pages Functions + Managed Neon Auth.
-- Synthetic-first migration. Apply only to a separately approved Clay Neon branch.
-- Pages Functions verify the bearer JWT, then set request.jwt.claims inside each
-- HTTP transaction. The database connection role is deliberately not a table
-- owner and does not have BYPASSRLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clay_fn_owner') THEN
    CREATE ROLE clay_fn_owner NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clay_app_runtime') THEN
    CREATE ROLE clay_app_runtime LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clay_anonymous') THEN
    CREATE ROLE clay_anonymous NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE clay_fn_owner NOLOGIN NOBYPASSRLS;
ALTER ROLE clay_app_runtime LOGIN NOBYPASSRLS;
ALTER ROLE clay_anonymous NOLOGIN NOBYPASSRLS;

-- The migration executor may assume the non-login function owner to create
-- SECURITY DEFINER routines owned by a role that cannot bypass RLS.
GRANT clay_fn_owner TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO clay_fn_owner;
GRANT USAGE ON SCHEMA public TO clay_app_runtime;

CREATE TABLE IF NOT EXISTS public.clay_sync_collections (
  user_id text NOT NULL,
  collection text NOT NULL CHECK (collection IN ('products','hair','log','prefs','scents')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection)
);

CREATE TABLE IF NOT EXISTS public.clay_sync_records (
  user_id text NOT NULL,
  collection text NOT NULL,
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
  generation bigint NOT NULL CHECK (generation > 0),
  version bigint NOT NULL CHECK (version > 0),
  payload jsonb,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection, record_id),
  FOREIGN KEY (user_id, collection)
    REFERENCES public.clay_sync_collections(user_id, collection)
    ON DELETE CASCADE,
  CHECK (deleted_at IS NOT NULL OR (payload IS NOT NULL AND jsonb_typeof(payload) = 'object'))
);

CREATE INDEX IF NOT EXISTS clay_sync_records_visible_idx
  ON public.clay_sync_records(user_id, collection, generation)
  WHERE deleted_at IS NULL;

ALTER TABLE public.clay_sync_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clay_sync_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clay_sync_collections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clay_sync_records FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.clay_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )
$$;

GRANT EXECUTE ON FUNCTION public.clay_current_user_id() TO clay_app_runtime, clay_fn_owner;
GRANT SELECT ON public.clay_sync_collections, public.clay_sync_records TO clay_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.clay_sync_collections, public.clay_sync_records
  TO clay_fn_owner;

DROP POLICY IF EXISTS clay_sync_collections_runtime_read ON public.clay_sync_collections;
CREATE POLICY clay_sync_collections_runtime_read
  ON public.clay_sync_collections
  FOR SELECT TO clay_app_runtime
  USING (public.clay_current_user_id() = user_id);

DROP POLICY IF EXISTS clay_sync_collections_function_owner ON public.clay_sync_collections;
CREATE POLICY clay_sync_collections_function_owner
  ON public.clay_sync_collections
  FOR ALL TO clay_fn_owner
  USING (public.clay_current_user_id() = user_id)
  WITH CHECK (public.clay_current_user_id() = user_id);

DROP POLICY IF EXISTS clay_sync_records_runtime_read ON public.clay_sync_records;
CREATE POLICY clay_sync_records_runtime_read
  ON public.clay_sync_records
  FOR SELECT TO clay_app_runtime
  USING (
    public.clay_current_user_id() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.clay_sync_collections AS current_collection
      WHERE current_collection.user_id = clay_sync_records.user_id
        AND current_collection.collection = clay_sync_records.collection
        AND current_collection.generation = clay_sync_records.generation
    )
  );

DROP POLICY IF EXISTS clay_sync_records_function_owner ON public.clay_sync_records;
CREATE POLICY clay_sync_records_function_owner
  ON public.clay_sync_records
  FOR ALL TO clay_fn_owner
  USING (public.clay_current_user_id() = user_id)
  WITH CHECK (public.clay_current_user_id() = user_id);

REVOKE ALL ON public.clay_sync_collections, public.clay_sync_records FROM PUBLIC, clay_app_runtime, clay_anonymous;
GRANT SELECT ON public.clay_sync_collections, public.clay_sync_records TO clay_app_runtime;
REVOKE ALL ON FUNCTION public.clay_current_user_id() FROM PUBLIC, clay_anonymous;
GRANT EXECUTE ON FUNCTION public.clay_current_user_id() TO clay_app_runtime, clay_fn_owner;

SET ROLE clay_fn_owner;

CREATE OR REPLACE FUNCTION public.clay_sync_apply_record(
  p_collection text,
  p_record_id text,
  p_expected_generation bigint,
  p_expected_version bigint,
  p_payload jsonb,
  p_delete boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := public.clay_current_user_id();
  v_generation bigint;
  v_revision bigint;
  v_record_generation bigint;
  v_record_version bigint;
  v_next_version bigint;
BEGIN
  IF v_user IS NULL OR length(v_user) = 0 THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_collection IS NULL OR p_collection NOT IN ('products','hair','log','prefs','scents') THEN
    RAISE EXCEPTION 'invalid collection' USING errcode = '22023';
  END IF;
  IF p_record_id IS NULL OR length(p_record_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid record id' USING errcode = '22023';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation < 1
     OR p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'invalid expected version' USING errcode = '22023';
  END IF;
  IF p_delete IS NULL THEN
    RAISE EXCEPTION 'delete flag is required' USING errcode = '22023';
  END IF;
  IF NOT p_delete AND (p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object') THEN
    RAISE EXCEPTION 'record payload must be a JSON object' USING errcode = '22023';
  END IF;

  INSERT INTO public.clay_sync_collections(user_id, collection)
  VALUES (v_user, p_collection)
  ON CONFLICT (user_id, collection) DO NOTHING;

  SELECT generation, revision INTO v_generation, v_revision
    FROM public.clay_sync_collections
    WHERE user_id = v_user AND collection = p_collection
    FOR UPDATE;

  IF p_expected_generation <> v_generation THEN
    RETURN jsonb_build_object('status','conflict','reason','generation_changed',
      'generation',v_generation,'revision',v_revision);
  END IF;

  SELECT generation, version INTO v_record_generation, v_record_version
    FROM public.clay_sync_records
    WHERE user_id = v_user AND collection = p_collection AND record_id = p_record_id
    FOR UPDATE;

  IF NOT FOUND OR v_record_generation <> v_generation THEN
    v_record_version := 0;
  END IF;

  IF p_expected_version <> v_record_version THEN
    RETURN jsonb_build_object('status','conflict','reason','record_changed',
      'generation',v_generation,'version',v_record_version,'revision',v_revision);
  END IF;

  v_next_version := v_record_version + 1;

  INSERT INTO public.clay_sync_records(
    user_id, collection, record_id, generation, version, payload, deleted_at, updated_at
  ) VALUES (
    v_user, p_collection, p_record_id, v_generation, v_next_version,
    CASE WHEN p_delete THEN NULL ELSE p_payload END,
    CASE WHEN p_delete THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id, collection, record_id) DO UPDATE SET
    generation = excluded.generation,
    version = excluded.version,
    payload = excluded.payload,
    deleted_at = excluded.deleted_at,
    updated_at = excluded.updated_at;

  UPDATE public.clay_sync_collections
    SET revision = revision + 1, updated_at = now()
    WHERE user_id = v_user AND collection = p_collection
    RETURNING revision INTO v_revision;

  RETURN jsonb_build_object('status','applied','generation',v_generation,
    'version',v_next_version,'revision',v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.clay_sync_clear_collection(
  p_collection text,
  p_expected_generation bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := public.clay_current_user_id();
  v_generation bigint;
  v_revision bigint;
BEGIN
  IF v_user IS NULL OR length(v_user) = 0 THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_collection IS NULL OR p_collection NOT IN ('products','hair','log','prefs','scents') THEN
    RAISE EXCEPTION 'invalid collection' USING errcode = '22023';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation < 1 THEN
    RAISE EXCEPTION 'invalid expected generation' USING errcode = '22023';
  END IF;

  INSERT INTO public.clay_sync_collections(user_id, collection)
  VALUES (v_user, p_collection)
  ON CONFLICT (user_id, collection) DO NOTHING;

  SELECT generation, revision INTO v_generation, v_revision
    FROM public.clay_sync_collections
    WHERE user_id = v_user AND collection = p_collection
    FOR UPDATE;

  IF p_expected_generation <> v_generation THEN
    RETURN jsonb_build_object('status','conflict','generation',v_generation,'revision',v_revision);
  END IF;

  UPDATE public.clay_sync_collections
    SET generation = generation + 1, revision = revision + 1, updated_at = now()
    WHERE user_id = v_user AND collection = p_collection
    RETURNING generation, revision INTO v_generation, v_revision;

  RETURN jsonb_build_object('status','cleared','generation',v_generation,'revision',v_revision);
END;
$$;

RESET ROLE;

REVOKE ALL ON FUNCTION public.clay_sync_apply_record(text,text,bigint,bigint,jsonb,boolean) FROM PUBLIC, clay_anonymous;
REVOKE ALL ON FUNCTION public.clay_sync_clear_collection(text,bigint) FROM PUBLIC, clay_anonymous;
GRANT EXECUTE ON FUNCTION public.clay_sync_apply_record(text,text,bigint,bigint,jsonb,boolean) TO clay_app_runtime;
GRANT EXECUTE ON FUNCTION public.clay_sync_clear_collection(text,bigint) TO clay_app_runtime;

-- Set a password for clay_app_runtime out-of-band in Neon, then store its
-- connection string only as the encrypted Cloudflare Pages DATABASE_URL secret.
