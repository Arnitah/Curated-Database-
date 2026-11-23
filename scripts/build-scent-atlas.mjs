// Build the self-contained Scent Atlas snapshot from the current source app and data.
//   node scripts/build-scent-atlas.mjs        write dist/scent-atlas.html
//   node scripts/build-scent-atlas.mjs --check verify the committed snapshot is current
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = path.join(ROOT, "apps", "scent-atlas.html");
const DIST_PATH = path.join(ROOT, "dist", "scent-atlas.html");
const LOAD_RE = /load\(\s*["']([^"']+)["']/g;

export function buildSnapshot(source, readData) {
  const paths = [...source.matchAll(LOAD_RE)].map((match) => match[1]);
  const unique = [...new Set(paths)].sort();
  if (!unique.length) throw new Error("No static load() data paths found in apps/scent-atlas.html");
  const bundle = {};
  for (const file of unique) {
    if (!/^(checks|data)\/[a-z0-9_/-]+\.json$/.test(file)) throw new Error("Unexpected bundled path: " + file);
    try { bundle[file] = JSON.parse(readData(file)); }
    catch (error) { throw new Error("Could not read valid JSON for " + file + ": " + error.message); }
  }
  const marker = 'const BASES = ["./", "../", GH];';
  if (!source.includes(marker)) throw new Error("Could not find the source BASES marker");
  if (source.includes("const BUNDLE = {")) throw new Error("Source app must not contain a generated BUNDLE");
  const start = source.indexOf("async function load(f, fallback) {");
  const end = source.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error("Could not isolate the source load() function");
  const oldLoader = source.slice(start, end + 2);
  const newLoader = [
    "async function load(f, fallback) {",
    "  if (Object.prototype.hasOwnProperty.call(BUNDLE, f)) return BUNDLE[f];",
    "  for (const b of BASES) { try { const r = await fetch(b + f, { cache: \"no-cache\" }); if (r.ok) return await r.json(); } catch (e) {} }",
    "  return fallback;",
    "}"
  ].join("\n");
  const withBundle = source.replace(marker, marker + "\nconst BUNDLE = " + JSON.stringify(bundle) + ";");
  return withBundle.replace(oldLoader, newLoader);
}

function main() {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const html = buildSnapshot(source, (file) => fs.readFileSync(path.join(ROOT, file), "utf8"));
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(DIST_PATH)) throw new Error("Missing dist/scent-atlas.html; run npm run build:scent-atlas");
    const current = fs.readFileSync(DIST_PATH, "utf8");
    if (current !== html) {
      console.error("dist/scent-atlas.html is stale. Run npm run build:scent-atlas and commit the result.");
      process.exitCode = 1;
      return;
    }
    console.log("OK  dist/scent-atlas.html matches apps/scent-atlas.html and all bundled data");
    return;
  }
  fs.mkdirSync(path.dirname(DIST_PATH), { recursive: true });
  fs.writeFileSync(DIST_PATH, html);
  console.log("Built dist/scent-atlas.html from " + [...new Set([...source.matchAll(LOAD_RE)].map((m) => m[1]))].length + " data files");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
