// Local test server: serves dist/ and runs the /api functions, like Vercel does.
// Usage: node build.mjs && AI_PROVIDER=mock node dev-server.mjs   (or set OPENAI_API_KEY)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      const mod = await import(`./api/${name}.js`);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) });
      const out = await mod[req.method](request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let file = path.join('dist', url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)));
    let body = await readFile(file).catch(() => null);
    if (!body) {
      file = 'dist/index.html';
      body = await readFile(file);
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
