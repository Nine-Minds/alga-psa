import { handler as userHandler } from './handler.js';
import type {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ContextData
} from '@alga-psa/extension-runtime';

// Raw imports from the WIT world - only import what we actually use
// @ts-ignore
import {
  logInfo,
  logWarn,
  logError
} from 'alga:extension/logging';
// @ts-ignore
import { callRoute as uiProxyCall } from 'alga:extension/ui-proxy';
// @ts-ignore
import { getContext } from 'alga:extension/context';

// Construct the HostBindings object that the SDK expects
// Only wire up capabilities that this extension actually uses:
// - cap:context.read
// - cap:log.emit
// - cap:ui.proxy
const host: HostBindings = {
  context: {
    get: async () => {
      return getContext() as unknown as ContextData;
    }
  },
  // Note: secrets, http, and storage are not used by this extension
  // and are not declared in manifest capabilities
  secrets: {
    get: async (_key: string) => { throw new Error('secrets not available - cap:secrets.get not granted'); },
    list: async () => { throw new Error('secrets not available - cap:secrets.get not granted'); }
  },
  http: {
    fetch: async (_req: Parameters<HostBindings['http']['fetch']>[0]) => { throw new Error('http not available - cap:http.fetch not granted'); }
  },
  storage: {
    get: async (_ns: string, _key: string) => { throw new Error('storage not available - cap:storage.kv not granted'); },
    put: async (_entry: Parameters<HostBindings['storage']['put']>[0]) => { throw new Error('storage not available - cap:storage.kv not granted'); },
    delete: async (_ns: string, _key: string) => { throw new Error('storage not available - cap:storage.kv not granted'); },
    list: async (_ns: string) => { throw new Error('storage not available - cap:storage.kv not granted'); }
  },
  logging: {
    info: async (msg: string) => logInfo(msg),
    warn: async (msg: string) => logWarn(msg),
    error: async (msg: string) => logError(msg)
  },
  uiProxy: {
    callRoute: async (route: string, payload: Uint8Array | null | undefined) => uiProxyCall(route, payload),
    call: async (route: string, payload: Uint8Array | null | undefined) => uiProxyCall(route, payload)
  }
};

// The export required by the WIT world (runner)
// This takes only `request` and provides `host` from the WIT imports
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
