// Minimal OpenAI-compatible chat-completions simulator for AI-gateway smoke tests.
// Serves POST /v1/chat/completions in both JSON and SSE-streaming forms, always
// reporting usage so the gateway's metering path can price and debit the call.
// Token counts are fixed and predictable: prompt=500, completion=500.
//
// Usage: node openai-sim.mjs [port]   (default 8791)

import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8791);
const PROMPT_TOKENS = 500;
const COMPLETION_TOKENS = 500;

let requestCount = 0;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    requestCount += 1;
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid json' } }));
      return;
    }
    const model = body.model ?? 'sim-model';
    const id = `chatcmpl-sim-${requestCount}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = {
      prompt_tokens: PROMPT_TOKENS,
      completion_tokens: COMPLETION_TOKENS,
      total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
    };
    const text = `Simulated response #${requestCount} from the smoke provider. All is well.`;
    console.log(`[openai-sim] #${requestCount} model=${model} stream=${body.stream === true}`);

    if (body.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunk = (delta, finish = null, withUsage = false) =>
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: delta === null ? [] : [{ index: 0, delta, finish_reason: finish }],
          ...(withUsage ? { usage } : {}),
        })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }));
      for (const word of text.split(' ')) {
        res.write(chunk({ content: word + ' ' }));
      }
      res.write(chunk({}, 'stop'));
      // Terminal usage chunk (OpenAI include_usage form: empty choices + usage).
      res.write(chunk(null, null, true));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage,
      }),
    );
  });
});

server.listen(PORT, () => console.log(`[openai-sim] listening on :${PORT}`));
