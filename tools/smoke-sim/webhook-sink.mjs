// Minimal webhook receiver for smoke tests: appends each request (headers + raw body) as JSONL.
import http from 'node:http';
import fs from 'node:fs';
const [port, out] = [Number(process.argv[2] || 18999), process.argv[3] || '/tmp/webhook-sink.jsonl'];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, headers: req.headers, body }) + '\n');
    console.log(new Date().toISOString(), req.method, req.url, req.headers['x-alga-event'] || '', body.slice(0, 200));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(port, '::', () => console.log('sink listening', port, out));
