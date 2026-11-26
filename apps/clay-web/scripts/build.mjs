import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');
const sourcePath = resolve(repoRoot, 'apps/clay.html');
const generatedHtml = resolve(appRoot, 'index.html');
const src = resolve(appRoot, 'src');
const html = await readFile(sourcePath, 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];

if (scripts.length !== 2 || !/\bid=["']ii-engine["']/.test(scripts[0][1]) || scripts[1][1].trim()) {
  throw new Error('Clay source shape changed: expected the engine bundle followed by one inline app script');
}

const appScript = scripts[1][2];
const scopedAppScript = appScript.replace(/(?<![\w$.])localStorage(?![\w$])/g, 'window.__clayScopedStorage');
const replacements = [scripts[0][0], '<script type="module" src="/src/main.js"></script>'];
let output = html.replace(scripts[0][0], replacements[0]).replace(scripts[1][0], replacements[1]);

if (output.includes('localStorage')) {
  // The only allowed direct localStorage access is the bootstrap's storage input.
  const remaining = [...output.matchAll(/\blocalStorage\b/g)];
  if (remaining.length) throw new Error('Unexpected direct localStorage reference remains in generated HTML');
}
if (!scopedAppScript.includes('window.__clayScopedStorage')) {
  throw new Error('The app bundle did not receive user-scoped storage rewrites');
}

await mkdir(src, { recursive: true });
await writeFile(resolve(src, 'clay-app.js'), scopedAppScript);
await writeFile(generatedHtml, output);
console.log('Clay standalone source prepared: engine preserved, app deferred, scoped storage rewritten.');
