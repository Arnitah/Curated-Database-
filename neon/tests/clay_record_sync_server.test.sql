-- Synthetic integration test for the server-side Pages + Neon JWT/RLS path.
-- Run only against an isolated local PostgreSQL service, never hosted user data.

DO $$
BEGIN
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'clay_app_runtime') THEN
    RAISE EXCEPTION 'application runtime role must not BYPASSRLS';
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'clay_fn_owner') THEN
    RAISE EXCEPTION 'security-definer owner must not BYPASSRLS';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'clay_fn_owner') THEN
    RAISE EXCEPTION 'security-definer owner must not be a login role';
  END IF;
END;
$$;

SET ROLE clay_app_runtime;

-- User A creates a record; transaction-local JWT claims scope the RPC and RLS.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-a","iss":"https://auth.example.test"}', true);
SELECT public.clay_sync_apply_record(
  'products', 'record-1', 1, 0, '{"name":"Synthetic A"}'::jsonb, false
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.clay_sync_records WHERE collection = 'products') <> 1 THEN
    RAISE EXCEPTION 'user A should read exactly their own record';
  END IF;
END;
$$;
COMMIT;

-- User B cannot read A's row.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-b","iss":"https://auth.example.test"}', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.clay_sync_records WHERE collection = 'products') <> 0 THEN
    RAISE EXCEPTION 'cross-user read was not denied by RLS';
  END IF;
END;
$$;
COMMIT;

-- User B may create the same record id in their own namespace; A's data stays isolated.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-b","iss":"https://auth.example.test"}', true);
SELECT public.clay_sync_apply_record(
  'products', 'record-1', 1, 0, '{"name":"Synthetic B"}'::jsonb, false
);
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT payload ->> 'name' INTO v_name
    FROM public.clay_sync_records
    WHERE collection = 'products' AND record_id = 'record-1';
  IF v_name IS DISTINCT FROM 'Synthetic B' THEN
    RAISE EXCEPTION 'user B did not see only their own record';
  END IF;
END;
$$;
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-a","iss":"https://auth.example.test"}', true);
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT payload ->> 'name' INTO v_name
    FROM public.clay_sync_records
    WHERE collection = 'products' AND record_id = 'record-1';
  IF v_name IS DISTINCT FROM 'Synthetic A' THEN
    RAISE EXCEPTION 'user A saw an unexpected or cross-user record';
  END IF;
END;
$$;
COMMIT;

-- Direct table writes are not granted to the application role.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-a"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.clay_sync_collections(user_id, collection)
    VALUES ('forged-user', 'hair');
    RAISE EXCEPTION 'direct table insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
COMMIT;

-- Stale writes are explicit conflicts rather than last-write-wins updates.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-a"}', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.clay_sync_apply_record(
    'products', 'record-1', 1, 0, '{"name":"Stale"}'::jsonb, false
  );
  IF v_result ->> 'status' <> 'conflict'
     OR v_result ->> 'reason' <> 'record_changed' THEN
    RAISE EXCEPTION 'stale write did not return the expected conflict';
  END IF;
END;
$$;
COMMIT;

-- Delete creates a tombstone; clear-all advances the collection generation.
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"synthetic-user-a"}', true);
SELECT public.clay_sync_apply_record('products', 'record-1', 1, 1, NULL, true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clay_sync_records
    WHERE user_id = 'synthetic-user-a'
      AND collection = 'products'
      AND record_id = 'record-1'
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'delete did not persist a tombstone';
  END IF;
END;
$$;
SELECT public.clay_sync_clear_collection('products', 1);
DO $$
BEGIN
  IF (SELECT generation FROM public.clay_sync_collections
      WHERE user_id = 'synthetic-user-a' AND collection = 'products') <> 2 THEN
    RAISE EXCEPTION 'clear-all did not advance generation';
  END IF;
  IF (SELECT count(*) FROM public.clay_sync_records
      WHERE collection = 'products' AND user_id = 'synthetic-user-a') <> 0 THEN
    RAISE EXCEPTION 'old-generation records remained visible after clear-all';
  END IF;
END;
$$;
COMMIT;

-- No claims means reads fail closed and mutation RPCs reject the request.
BEGIN;
SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT count(*) FROM public.clay_sync_records) <> 0 THEN
    RAISE EXCEPTION 'missing JWT claims unexpectedly exposed rows';
  END IF;
  BEGIN
    v_result := public.clay_sync_clear_collection('products', 1);
    RAISE EXCEPTION 'mutation without claims unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '28000' THEN NULL;
  END;
END;
$$;
COMMIT;

RESET ROLE;
SET ROLE clay_anonymous;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.clay_sync_records;
    RAISE EXCEPTION 'anonymous table read unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clay_sync_clear_collection('products', 1);
    RAISE EXCEPTION 'anonymous mutation unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
