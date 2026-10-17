// Minimal OpenAI-compatible loopback used to smoke-test ticket-conversation AI
// participation without calling a real external model. Returns deterministic,
// clearly-synthetic prose so evidence is never mistaken for model quality.
import { createServer } from 'node:http';
const PORT = Number(process.env.PORT || 4545);
createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(404).end('{}'); return;
    }
    let task = 'conversation_reply';
    try { task = JSON.parse(JSON.parse(body).messages.at(-1).content).task || task; } catch {}
    const text = `[SIMULATED AI - smoke test] Task: ${task}. Summary: three MFP units report error E-502 after a firmware update. Acme approved RMA-88213 with a 5 business day turnaround. Suggested next step: confirm depot shipping labels with the customer.`;
    const payload = { id: 'chatcmpl-smoke', object: 'chat.completion', created: Math.floor(Date.now()/1000),
      model: 'smoke-sim', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 } };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
  });
}).listen(PORT, () => console.log('ai-gateway-sim listening on', PORT));
