// Minimal TypeSafe /v1/systemone simulator: logs every request body (what leaves the tenant) and scores 0.9.
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.env.SIM_PORT || 4799);
const log = process.env.SIM_LOG || '/tmp/typesafe-sim-requests.jsonl';
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, body: body ? JSON.parse(body) : null }) + '\n');
    console.log(`${req.method} ${req.url} ${body.length}b`);
    if (req.url === '/v1/systemone') {
      const q = body ? JSON.parse(body).questions ?? {} : {};
      const answers = Object.fromEntries(Object.keys(q).map((k) => [k, { type: 'noul', noul: 0.9 }]));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answers, model: 'smoke-sim', usage: { input_tokens: 10, output_tokens: 1 } }));
    } else if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ id: 'smoke-sim' }] }));
    } else { res.writeHead(404); res.end('{}'); }
  });
}).listen(port, '127.0.0.1', () => console.log(`typesafe sim on ${port}, log ${log}`));
