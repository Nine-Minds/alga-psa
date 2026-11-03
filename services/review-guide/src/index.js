import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const evidenceRoot = resolve(process.env.REVIEW_EVIDENCE_DIR ?? '/tmp/alga-smoke-evidence/security-ticket-options-20261102-0842');
const port = Number(process.env.PORT ?? 33453);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webm': 'video/webm',
};

function sendFile(request, response, file) {
  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }

  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Content-Type', mimeTypes[extname(file)] ?? 'application/octet-stream');
  if (!range) {
    response.writeHead(200, { 'Content-Length': stat.size });
    createReadStream(file).pipe(response);
    return;
  }

  const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2] || 0));
  const end = Math.min(range[2] && range[1] ? Number(range[2]) : stat.size - 1, stat.size - 1);
  if (start >= stat.size || start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
    return;
  }
  response.writeHead(206, {
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
  });
  createReadStream(file, { start, end }).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const guide = readFileSync(join(root, 'index.html'), 'utf8')
      .replaceAll('@@HEAD@@', process.env.REVIEW_HEAD_SHA ?? 'unpublished');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(guide);
    return;
  }
  if (url.pathname.startsWith('/evidence/')) {
    const name = decodeURIComponent(url.pathname.slice('/evidence/'.length));
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      response.writeHead(400).end('Invalid evidence path');
      return;
    }
    const file = resolve(evidenceRoot, name);
    if (!file.startsWith(`${evidenceRoot}${sep}`)) {
      response.writeHead(400).end('Invalid evidence path');
      return;
    }
    sendFile(request, response, file);
    return;
  }
  response.writeHead(404).end('Not found');
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`review-guide: serving ${root} and ${evidenceRoot} on :${port}\n`);
});
