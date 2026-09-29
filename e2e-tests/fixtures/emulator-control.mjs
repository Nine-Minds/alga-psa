/** Control-plane client; application traffic must still use vendor endpoints. */
export class EmulatorControl {
  constructor(baseURL, providers, { timeoutMs = 10000 } = {}) {
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Emulator control URL must be an HTTP origin without credentials, query or fragment');
    }
    if (url.pathname !== '/') throw new Error('Emulator control URL must be an origin');
    if (!providers.length || new Set(providers).size !== providers.length || providers.some(id => !/^[a-z][a-z0-9-]*$/.test(id))) {
      throw new Error('Select a nonempty, unique set of emulator provider IDs');
    }
    this.baseURL = url.origin;
    this.providers = [...providers];
    this.timeoutMs = timeoutMs;
    this.operations = [];
  }

  async call(path, body) {
    const method = body === undefined ? 'GET' : 'POST';
    const response = await fetch(`${this.baseURL}/control/${path}`, {
      method, signal: AbortSignal.timeout(this.timeoutMs),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    // Do not echo params or response bodies: seeders may contain credentials.
    this.operations.push({ path, method, status: response.status });
    if (!response.ok) throw new Error(`Emulator control ${method} ${path} returned ${response.status}`);
    const payload = await response.json();
    if (payload?.ok !== true) throw new Error(`Emulator control ${method} ${path} did not return ok:true`);
    return payload.result;
  }

  path(provider, suffix) {
    if (!this.providers.includes(provider)) throw new Error(`Provider ${provider} is outside this scenario`);
    return `${provider}/${suffix}`;
  }
  seed(provider, name, params) { return this.call(this.path(provider, `seed/${encodeURIComponent(name)}`), params); }
  action(provider, name, params = {}) { return this.call(this.path(provider, `actions/${encodeURIComponent(name)}`), params); }
  arm(provider, name, params = {}) { return this.call(this.path(provider, `faults/${encodeURIComponent(name)}/arm`), params); }
  disarm(provider, name) { return this.call(this.path(provider, `faults/${encodeURIComponent(name)}/disarm`), {}); }
  state(provider, view) { return this.call(this.path(provider, `state/${encodeURIComponent(view)}`)); }
  requests(provider) { return this.call(this.path(provider, 'requests')); }

  async reset() {
    for (const provider of this.providers) {
      const history = await this.requests(provider);
      if (history.inFlight !== 0) throw new Error(`Cannot reset ${provider} with vendor requests still in flight`);
    }
    for (const provider of this.providers) await this.call(this.path(provider, 'reset'), {});
  }

  async diagnostics() {
    const requests = {};
    for (const provider of this.providers) requests[provider] = await this.requests(provider);
    return { controlOrigin: this.baseURL, providers: this.providers, operations: [...this.operations], requests };
  }
}
