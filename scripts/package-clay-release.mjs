// Build and verify a self-contained Clay release package.
// Output: dist/clay-release/{apps/clay.html,index/clay/products/*,release-manifest.json}
// The package is intentionally data-complete: artifact hosting must serve the index beside the page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'clay-release');
const INDEX_REL = 'index/clay/products';
const PRODUCT_DIR = path.join(ROOT, INDEX_REL);
const SHARD_COUNT = 40;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const fail = (message) => { console.error(`Clay release package: ${message}`); process.exitCode = 1; };

function inspectSource() {
  const htmlPath = path.join(ROOT, 'apps/clay.html');
  const metaPath = path.join(PRODUCT_DIR, 'meta.json');
  const namesPath = path.join(PRODUCT_DIR, 'names.json');
  for (const p of [htmlPath, metaPath, namesPath]) if (!fs.existsSync(p)) throw new Error(`required file missing: ${path.relative(ROOT, p)}`);
  const meta = readJson(metaPath);
  const names = readJson(namesPath);
  if (!Number.isInteger(meta.products) || meta.products < 1) throw new Error('meta.products must be a positive integer');
  if (meta.shards !== SHARD_COUNT) throw new Error(`expected ${SHARD_COUNT} shards in meta.json, found ${meta.shards}`);
  if (!Array.isArray(names.rows) || names.rows.length !== meta.products) throw new Error(`names.json rows (${names.rows?.length ?? 'invalid'}) do not match meta.products (${meta.products})`);
  const shardFiles = Array.from({ length: SHARD_COUNT }, (_, i) => `${String(i).padStart(3, '0')}.json`);
  const actualJson = fs.readdirSync(PRODUCT_DIR).filter((f) => f.endsWith('.json')).sort();
  const expectedJson = [...shardFiles, 'meta.json', 'names.json'].sort();
  if (JSON.stringify(actualJson) !== JSON.stringify(expectedJson)) throw new Error(`index JSON file set differs from expected 40 shards + meta + names: ${actualJson.join(', ')}`);
  let rows = 0;
  const files = ['clay.html', ...expectedJson.map((f) => `${INDEX_REL}/${f}`)];
  for (const name of shardFiles) {
    const data = readJson(path.join(PRODUCT_DIR, name));
    if (!Array.isArray(data)) throw new Error(`${name} must contain a JSON array`);
    for (const [i, row] of data.entries()) {
      if (!Array.isArray(row) || row.length < 5 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
        throw new Error(`${name} row ${i} has an unexpected product-index shape`);
      }
    }
    rows += data.length;
  }
  if (rows !== meta.products) throw new Error(`shard rows (${rows}) do not match meta.products (${meta.products})`);
  const app = fs.readFileSync(htmlPath, 'utf8');
  if (!app.includes("clayFetch('index/clay/products/names.json')")) throw new Error('Clay page no longer points to the colocated product index; review packaging contract');
  return { files, products: meta.products, shards: meta.shards, built_at: meta.built_at, names_rows: names.rows.length };
}

function hashFiles(root, relPaths) {
  return relPaths.map((rel) => {
    const bytes = fs.readFileSync(path.join(root, rel));
    return { path: rel, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function build() {
  const info = inspectSource();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, INDEX_REL), { recursive: true });
  // Serve the page at package root so its relative index/clay/... requests resolve correctly.
  fs.copyFileSync(path.join(ROOT, 'apps/clay.html'), path.join(OUT, 'clay.html'));
  for (const rel of info.files.filter((p) => p.startsWith(INDEX_REL + '/'))) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, rel));
  }
  const version = readJson(path.join(ROOT, 'version.json'));
  const manifest = {
    format: 'clay-release-package/v1',
    source_commit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || null,
    app: 'clay.html',
    product_index: INDEX_REL,
    product_count: info.products,
    shard_count: info.shards,
    index_built_at: info.built_at,
    repository_version: version.version,
    files: hashFiles(OUT, info.files),
  };
  fs.writeFileSync(path.join(OUT, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  verify();
  console.log(`Clay release package built and verified: ${info.products.toLocaleString()} products, ${info.shards} shards, ${manifest.files.length} files.`);
}

function verify() {
  const manifestPath = path.join(OUT, 'release-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('release-manifest.json is missing');
  const manifest = readJson(manifestPath);
  if (manifest.format !== 'clay-release-package/v1' || !Array.isArray(manifest.files)) throw new Error('unsupported or malformed release manifest');
  if (manifest.files.length !== 43) throw new Error(`expected 43 packaged files (HTML + 42 index files), found ${manifest.files.length}`);
  for (const file of manifest.files) {
    const full = path.join(OUT, file.path);
    if (!fs.existsSync(full)) throw new Error(`packaged file missing: ${file.path}`);
    const bytes = fs.readFileSync(full);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`packaged file integrity mismatch: ${file.path}`);
  }
  const meta = readJson(path.join(OUT, INDEX_REL, 'meta.json'));
  const names = readJson(path.join(OUT, INDEX_REL, 'names.json'));
  if (meta.products !== manifest.product_count || names.rows?.length !== manifest.product_count || meta.shards !== manifest.shard_count) {
    throw new Error('manifest, names list and index metadata disagree');
  }
  const shardRows = Array.from({ length: manifest.shard_count }, (_, i) => readJson(path.join(OUT, INDEX_REL, `${String(i).padStart(3, '0')}.json`)).length).reduce((a, b) => a + b, 0);
  if (shardRows !== manifest.product_count) throw new Error('packaged shard row count does not match manifest');
  return manifest;
}

try {
  if (process.argv.includes('--verify')) {
    const m = verify();
    console.log(`Clay release package verified: ${m.product_count.toLocaleString()} products, ${m.shard_count} shards, all ${m.files.length} file hashes match.`);
  } else {
    build();
  }
} catch (error) {
  fail(error.message);
}
