// Minimal TypeSafe System One client for CI scripts: no SDK dependency, so the
// selection job can run on a bare checkout. Retries the documented transient
// statuses (429, 529) and 5xx with backoff; fails fast on auth and validation.
const DEFAULTS = { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', retries: 4, timeoutMs: 90_000, concurrency: 4 };

export class TypeSafeError extends Error {
  constructor(message, { status, body, transient = false } = {}) {
    super(message);
    this.name = 'TypeSafeError';
    this.status = status;
    this.body = body;
    this.transient = transient;
  }
}

function limiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active--; next(); });
  };
  return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}

export function createTypeSafeClient(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const run = limiter(config.concurrency);
  const usage = { requests: 0, retries: 0, input_tokens: 0, output_tokens: 0 };

  async function once({ state, questions }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: config.model, state, questions }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        throw new TypeSafeError(`TypeSafe responded ${response.status}`, { status: response.status, body: text.slice(0, 2000), transient });
      }
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed.answers !== 'object') throw new TypeSafeError('TypeSafe response has no answers', { body: text.slice(0, 2000) });
      return parsed;
    } catch (error) {
      if (error.name === 'AbortError') throw new TypeSafeError(`TypeSafe request timed out after ${config.timeoutMs}ms`, { transient: true });
      if (error instanceof TypeSafeError) throw error;
      throw new TypeSafeError(`TypeSafe request failed: ${error.message}`, { transient: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function systemOne(request) {
    if (!apiKey) throw new TypeSafeError('TYPESAFE_API_KEY is not set', { status: 401 });
    return run(async () => {
      for (let attempt = 0; ; attempt++) {
        usage.requests++;
        try {
          const result = await once(request);
          usage.input_tokens += result.usage?.input_tokens ?? 0;
          usage.output_tokens += result.usage?.output_tokens ?? 0;
          return result;
        } catch (error) {
          if (!error.transient || attempt >= config.retries) throw error;
          usage.retries++;
          await sleep(Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250);
        }
      }
    });
  }

  return { available: Boolean(apiKey), model: config.model, systemOne, usage };
}
