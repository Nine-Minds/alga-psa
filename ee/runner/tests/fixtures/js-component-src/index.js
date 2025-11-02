import { get as secretGet, listKeys as secretListKeys } from 'alga:extension/secrets';
import { callRoute as uiProxyCallRoute } from 'alga:extension/ui-proxy';

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class {
    encode(value) {
      const text = String(value);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) {
        bytes[i] = text.charCodeAt(i) & 0xff;
      }
      return bytes;
    }

    encodeInto(source, destination) {
      const text = String(source);
      const len = Math.min(text.length, destination.length);
      for (let i = 0; i < len; i += 1) {
        destination[i] = text.charCodeAt(i) & 0xff;
      }
      return { read: len, written: len };
    }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    decode(view) {
      if (!view || typeof view.length !== 'number') {
        return '';
      }
      let result = '';
      for (let i = 0; i < view.length; i += 1) {
        result += String.fromCharCode(view[i]);
      }
      return result;
    }
  };
}

if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} };
}

if (globalThis.process && globalThis.process.env && !globalThis.process.env.JCO_DEBUG) {
  globalThis.process.env.JCO_DEBUG = '1';
}

const __logBuffer = [];

if (typeof globalThis.console === 'undefined') {
  globalThis.console = {};
}

const noop = () => {};

const appendLog = (level, args) => {
  try {
    const msg = `[${level}] ${args.map((value) => String(value)).join(' ')}`;
    __logBuffer.push(msg);
  } catch (_) {
    __logBuffer.push(`[${level}] <unprintable>`);
  }
};

globalThis.console.log = (...args) => appendLog('log', args);
globalThis.console.info = (...args) => appendLog('info', args);
globalThis.console.warn = (...args) => appendLog('warn', args);
globalThis.console.error = (...args) => appendLog('error', args);

let __nextTimeoutId = 1;
const __scheduledTimeouts = new Map();

if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = (fn) => {
    if (typeof fn !== 'function') {
      return 0;
    }
    const id = __nextTimeoutId++;
    const run = () => {
      if (!__scheduledTimeouts.has(id)) {
        return;
      }
      __scheduledTimeouts.delete(id);
      try {
        fn();
      } catch (err) {
        console.error('setTimeout callback failed', err);
      }
    };
    __scheduledTimeouts.set(id, run);
    Promise.resolve().then(run);
    return id;
  };
}

if (typeof globalThis.clearTimeout === 'undefined') {
  globalThis.clearTimeout = (id) => {
    __scheduledTimeouts.delete(id);
  };
}

const encoder = new TextEncoder();

function encodeJson(value) {
  return encoder.encode(JSON.stringify(value));
}

export async function handler(request, host) {
  const logInfo =
    host && host.logging && typeof host.logging.info === 'function'
      ? (msg) => {
          try {
            return host.logging.info(String(msg));
          } catch (_) {
            return Promise.resolve();
          }
        }
      : () => Promise.resolve();
  const flushLogs = async () => {
    while (__logBuffer.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const entry = __logBuffer.shift();
      await logInfo(entry);
    }
  };

  try {
    console.log('js component handler invoked');
    await flushLogs();
    const ctx = request.context;
    const httpUrl = request?.http?.url || request?.http?.path || '';

    if (httpUrl.startsWith('/dynamic/secrets')) {
      let secretValue = null;
      let keys = [];
      let secretError = null;
      try {
        keys = (await secretListKeys()) ?? [];
      } catch (err) {
        secretError = err instanceof Error ? err.message : String(err);
      }
      if (!secretError) {
        try {
          secretValue = await secretGet('ALGA_API_KEY');
        } catch (err) {
          secretError = err instanceof Error ? err.message : String(err);
        }
      }
      return {
        status: 200,
        headers: [
          { name: 'content-type', value: 'application/json' },
          { name: 'x-generated-by', value: 'js-component' }
        ],
        body: encodeJson({
          ok: secretError === null,
          method: request.http.method,
          path: request.http.url,
          tenantId: ctx?.tenantId ?? null,
          extensionId: ctx?.extensionId ?? null,
          secrets: {
            value: secretValue,
            keys,
            error: secretError
          }
        })
      };
    }

    if (httpUrl.startsWith('/dynamic/ui-proxy')) {
      let proxyResponse = null;
      let proxyError = null;
      try {
        const payload = request.http.body ? new Uint8Array(request.http.body) : new Uint8Array();
        const bytes = await uiProxyCallRoute('/proxy/ping', payload.length ? payload : null);
        proxyResponse = bytes ? Array.from(bytes) : null;
      } catch (err) {
        proxyError = err instanceof Error ? err.message : String(err);
      }
      return {
        status: 200,
        headers: [
          { name: 'content-type', value: 'application/json' },
          { name: 'x-generated-by', value: 'js-component' }
        ],
        body: encodeJson({
          ok: proxyError === null,
          method: request.http.method,
          path: request.http.url,
          tenantId: ctx?.tenantId ?? null,
          extensionId: ctx?.extensionId ?? null,
          proxy: {
            response: proxyResponse,
            error: proxyError
          }
        })
      };
    }

    return {
      status: 200,
      headers: [
        { name: 'content-type', value: 'application/json' },
        { name: 'x-generated-by', value: 'js-component' }
      ],
      body: encodeJson({
        ok: true,
        method: request.http.method,
        path: request.http.url,
        tenantId: ctx?.tenantId ?? null,
        extensionId: ctx?.extensionId ?? null,
        echo: request.http.body ? Array.from(request.http.body) : null
      })
    };
  } catch (err) {
    console.error('js component error', err);
    await flushLogs();
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 500,
      headers: [{ name: 'content-type', value: 'application/json' }],
      body: encodeJson({ ok: false, error: message })
    };
  }
}
