// Static server for the repo root, bound to 127.0.0.1 only. Serves files read-only; nothing is written.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript' };

export function startServer() {
  const server = http.createServer((req, res) => {
    const f = path.join(REPO_ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(REPO_ROOT)) { res.statusCode = 403; return res.end(); }
    fs.readFile(f, (e, b) => {
      if (e) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream');
      res.end(b);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ base: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
  }));
}
