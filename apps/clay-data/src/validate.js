// A deliberately small JSON Schema subset validator for the Clay v2 contract. It is NOT a general JSON Schema implementation.
// Dependency-free. The only I/O is loadShippedSchemas(), which reads the committed files in ../schema/ (Node only).
// Rules: draft 2020-12 documents; only the keywords listed in KEYWORDS; nothing unsupported is silently ignored;
// $ref is local (#/$defs/x) or <schema-id>#/$defs/x against an in-memory registry; no network, no relative paths.
// validate() never throws on bad DATA and never mutates it. Loading a schema throws SchemaError on a bad SCHEMA.
import { readFileSync, readdirSync } from 'node:fs';

export class SchemaError extends Error {
  constructor(code, pointer, keyword) {
    super(code + (keyword ? ' (' + keyword + ')' : '') + ' at ' + (pointer || '/'));
    this.name = 'SchemaError'; this.code = code; this.pointer = pointer; if (keyword) this.keyword = keyword;
  }
}

const ANNOTATIONS = new Set(['$comment', 'title', 'description']);
const KEYWORDS = new Set(['$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description', 'type', 'enum', 'const', 'properties', 'required',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'oneOf']);
const TYPES = new Set(['string', 'integer', 'boolean', 'object', 'array', 'null']);
const MAX_REF_DEPTH = 16;
const MAX_PATTERN = 200;
const MAX_PATTERN_LENGTH_FIELD = 256;
const MAX_INSTANCE_DEPTH = 64;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

// ---- JSON Pointer (RFC 6901) ---------------------------------------------------------------------
// Fragment: percent-decode first, then unescape each token (~1 -> /, then ~0 -> ~).
export function decodeFragment(fragment) {
  try { return decodeURIComponent(fragment); } catch { throw new SchemaError('pointer_invalid', '', 'percent-encoding'); }
}
export function parsePointer(pointer) {
  if (pointer === '') return [];
  if (pointer[0] !== '/') throw new SchemaError('pointer_invalid', pointer, 'must be empty or start with /');
  return pointer.slice(1).split('/').map((tok) => {
    if (/~(?![01])/.test(tok) || /~$/.test(tok)) throw new SchemaError('pointer_invalid', pointer, 'bad ~ escape');
    return tok.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}
export function resolvePointer(doc, pointer) {
  let cur = doc;
  for (const tok of parsePointer(pointer)) {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(tok) || Number(tok) >= cur.length) throw new SchemaError('pointer_unresolved', pointer);
      cur = cur[Number(tok)];
    } else if (cur !== null && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, tok)) cur = cur[tok];
    else throw new SchemaError('pointer_unresolved', pointer);
  }
  return cur;
}

// ---- Loading and checking schemas ------------------------------------------------------------------
function checkSchemaNode(node, ptr, ctx) {
  if (typeof node === 'boolean') return;
  if (!isPlain(node)) throw new SchemaError('invalid_schema', ptr);
  for (const k of Object.keys(node)) if (!KEYWORDS.has(k)) throw new SchemaError('unsupported_keyword', ptr + '/' + esc(k), k);
  if ('$ref' in node) {
    for (const k of Object.keys(node)) if (k !== '$ref' && !ANNOTATIONS.has(k)) throw new SchemaError('ref_sibling', ptr + '/' + esc(k), k);
    if (typeof node.$ref !== 'string') throw new SchemaError('invalid_ref', ptr + '/$ref');
    ctx.refs.push({ ref: node.$ref, ptr: ptr + '/$ref' });
    return;
  }
  if ('type' in node) {
    if (typeof node.type !== 'string' || !TYPES.has(node.type)) throw new SchemaError('unsupported_type', ptr + '/type', 'type');
  }
  if ('enum' in node && (!Array.isArray(node.enum) || node.enum.length === 0)) throw new SchemaError('invalid_enum', ptr + '/enum');
  if ('required' in node && (!Array.isArray(node.required) || node.required.some((x) => typeof x !== 'string'))) throw new SchemaError('invalid_required', ptr + '/required');
  for (const k of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (k in node && !(Number.isSafeInteger(node[k]) && node[k] >= 0)) throw new SchemaError('invalid_bound', ptr + '/' + k, k);
  for (const k of ['minimum', 'maximum']) if (k in node && !Number.isSafeInteger(node[k])) throw new SchemaError('invalid_bound', ptr + '/' + k, k);
  if ('pattern' in node) {
    const p = node.pattern;
    if (typeof p !== 'string' || p.length > MAX_PATTERN) throw new SchemaError('invalid_pattern', ptr + '/pattern', 'pattern');
    try { ctx.compiled.set(ptr, new RegExp(p, 'u')); } catch { throw new SchemaError('invalid_pattern', ptr + '/pattern', 'pattern'); }
    if (!(Number.isSafeInteger(node.maxLength) && node.maxLength <= MAX_PATTERN_LENGTH_FIELD)) throw new SchemaError('pattern_requires_maxLength', ptr + '/maxLength', 'maxLength');
  }
  if ('oneOf' in node) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) throw new SchemaError('oneOf_empty', ptr + '/oneOf', 'oneOf');
    node.oneOf.forEach((s, i) => checkSchemaNode(s, ptr + '/oneOf/' + i, ctx));
  }
  if ('properties' in node) {
    if (!isPlain(node.properties)) throw new SchemaError('invalid_schema', ptr + '/properties');
    for (const [k, s] of Object.entries(node.properties)) checkSchemaNode(s, ptr + '/properties/' + esc(k), ctx);
  }
  if ('additionalProperties' in node && typeof node.additionalProperties !== 'boolean') checkSchemaNode(node.additionalProperties, ptr + '/additionalProperties', ctx);
  if ('items' in node) checkSchemaNode(node.items, ptr + '/items', ctx);
  if ('$defs' in node) {
    if (!isPlain(node.$defs)) throw new SchemaError('invalid_schema', ptr + '/$defs');
    for (const [k, s] of Object.entries(node.$defs)) checkSchemaNode(s, ptr + '/$defs/' + esc(k), ctx);
  }
}

export function createRegistry(schemas) {
  const byId = new Map();
  const compiled = new Map(); // key: schemaId + ptr
  const ctxs = [];
  for (const s of schemas) {
    if (!isPlain(s) || typeof s.$id !== 'string' || s.$id === '') throw new SchemaError('missing_id', '');
    if (byId.has(s.$id)) throw new SchemaError('duplicate_id', '', s.$id);
    byId.set(s.$id, s);
  }
  for (const [id, s] of byId) {
    const ctx = { refs: [], compiled: new Map(), id };
    checkSchemaNode(s, '', ctx);
    for (const [p, re] of ctx.compiled) compiled.set(id + '\u0000' + p, re);
    ctxs.push(ctx);
  }
  // Resolve a ref from a given schema: returns { schemaId, node, ptr }.
  function target(fromId, ref, ptrForError) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) throw new SchemaError('ref_remote', ptrForError, ref);
    const hash = ref.indexOf('#');
    if (hash === -1) throw new SchemaError('ref_not_local_defs', ptrForError, ref);
    const idPart = ref.slice(0, hash);
    const frag = decodeFragment(ref.slice(hash + 1));
    let doc = byId.get(fromId), id = fromId;
    if (idPart !== '') { if (!byId.has(idPart)) throw new SchemaError('ref_unknown_schema', ptrForError, ref); id = idPart; doc = byId.get(idPart); }
    if (!frag.startsWith('/$defs/')) throw new SchemaError('ref_not_local_defs', ptrForError, ref);
    let node;
    try { node = resolvePointer(doc, frag); } catch (e) { throw new SchemaError(e.code === 'pointer_invalid' ? 'pointer_invalid' : 'ref_unresolved', ptrForError, ref); }
    return { schemaId: id, node, ptr: frag };
  }
  // Follow a chain of pure $ref nodes. Detects cycles and depth.
  function follow(schemaId, node, ptrForError) {
    let id = schemaId, cur = node, hops = 0, at;
    const seen = new Set();
    while (isPlain(cur) && '$ref' in cur) {
      hops++;
      if (hops > MAX_REF_DEPTH) throw new SchemaError('ref_depth_exceeded', ptrForError, cur.$ref);
      const t = target(id, cur.$ref, ptrForError);
      const key = t.schemaId + '\u0000' + t.ptr;
      if (seen.has(key)) throw new SchemaError('ref_cycle', ptrForError, cur.$ref);
      seen.add(key);
      id = t.schemaId; cur = t.node; at = t.ptr;
    }
    return { schemaId: id, node: cur, ptr: at };
  }
  // Every ref must resolve at load time.
  for (const ctx of ctxs) for (const r of ctx.refs) follow(ctx.id, { $ref: r.ref }, r.ptr);

  const reg = {
    ids: () => [...byId.keys()],
    get: (id) => byId.get(id),
    validate(schemaId, value) {
      const root = byId.get(schemaId);
      if (!root) throw new SchemaError('ref_unknown_schema', '', schemaId);
      const errors = [];
      run(schemaId, root, '', value, '', errors, 0);
      return { ok: errors.length === 0, errors };
    }
  };

  function typeOk(t, v) {
    switch (t) {
      case 'string': return typeof v === 'string';
      case 'integer': return typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);
      case 'boolean': return typeof v === 'boolean';
      case 'object': return isPlain(v);
      case 'array': return Array.isArray(v);
      case 'null': return v === null;
      default: return false;
    }
  }
  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function run(schemaId, node, sptr, v, ip, errors, depth) {
    if (depth > MAX_INSTANCE_DEPTH) { errors.push({ code: 'max_depth', path: ip }); return; }
    if (node === true) return;
    if (node === false) { errors.push({ code: 'false_schema', path: ip }); return; }
    if ('$ref' in node) { const f = follow(schemaId, node, sptr); run(f.schemaId, f.node, f.ptr, v, ip, errors, depth + 1); return; }
    if ('type' in node && !typeOk(node.type, v)) { errors.push({ code: 'type', path: ip }); return; }
    if ('enum' in node && !node.enum.some((x) => deepEqual(x, v))) errors.push({ code: 'enum', path: ip });
    if ('const' in node && !deepEqual(node.const, v)) errors.push({ code: 'const', path: ip });
    if (typeof v === 'string') {
      const len = [...v].length;
      if ('minLength' in node && len < node.minLength) errors.push({ code: 'min_length', path: ip });
      if ('maxLength' in node && len > node.maxLength) errors.push({ code: 'max_length', path: ip });
      if ('pattern' in node && !compiled.get(schemaId + '\u0000' + sptr).test(v)) errors.push({ code: 'pattern', path: ip });
    }
    if (typeof v === 'number') {
      if ('minimum' in node && v < node.minimum) errors.push({ code: 'minimum', path: ip });
      if ('maximum' in node && v > node.maximum) errors.push({ code: 'maximum', path: ip });
    }
    if (Array.isArray(v)) {
      if ('minItems' in node && v.length < node.minItems) errors.push({ code: 'min_items', path: ip });
      if ('maxItems' in node && v.length > node.maxItems) errors.push({ code: 'max_items', path: ip });
      if ('items' in node) v.forEach((x, i) => run(schemaId, node.items, sptr + '/items', x, ip + '/' + i, errors, depth + 1));
    }
    if (isPlain(v)) {
      if ('required' in node) for (const k of node.required) if (!Object.prototype.hasOwnProperty.call(v, k) || v[k] === undefined) errors.push({ code: 'required', path: ip + '/' + esc(k) });
      const props = node.properties || {};
      for (const k of Object.keys(v)) {
        if (Object.prototype.hasOwnProperty.call(props, k)) run(schemaId, props[k], sptr + '/properties/' + esc(k), v[k], ip + '/' + esc(k), errors, depth + 1);
        else if ('additionalProperties' in node) {
          const ap = node.additionalProperties;
          if (ap === false) errors.push({ code: 'additional_property', path: ip + '/' + esc(k) });
          else if (ap !== true) run(schemaId, ap, sptr + '/additionalProperties', v[k], ip + '/' + esc(k), errors, depth + 1);
        }
      }
    }
    if ('oneOf' in node) {
      let matches = 0;
      node.oneOf.forEach((b, i) => { const e = []; run(schemaId, b, sptr + '/oneOf/' + i, v, ip, e, depth + 1); if (e.length === 0) matches++; });
      if (matches === 0) errors.push({ code: 'oneOf_no_match', path: ip });
      else if (matches > 1) errors.push({ code: 'oneOf_multiple_match', path: ip });
    }
  }
  return reg;
}

// Node-only convenience: read and register exactly the schema files that ship in apps/clay-data/schema/.
export function loadShippedSchemas() {
  const dir = new URL('../schema/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  return files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
}
export function createShippedRegistry() { return createRegistry(loadShippedSchemas()); }
