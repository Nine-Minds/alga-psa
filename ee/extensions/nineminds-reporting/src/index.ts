import { handler as userHandler } from './handler.js';
import type {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ContextData
} from '@alga-psa/extension-runtime';

// Raw imports from the WIT world
// @ts-ignore
import { get as getSecret, listKeys as listSecrets } from 'alga:extension/secrets';
// @ts-ignore
import { fetch as httpFetch } from 'alga:extension/http';
// @ts-ignore
import {
  get as storageGet,
  put as storagePut,
  delete as storageDelete,
  listEntries as storageList
} from 'alga:extension/storage';
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
const host: HostBindings = {
  context: {
    get: async () => {
      return getContext() as unknown as ContextData;
    }
  },
  secrets: {
    get: async (key: string) => getSecret(key),
    list: async () => listSecrets()
  },
  http: {
    fetch: async (req: Parameters<HostBindings['http']['fetch']>[0]) => httpFetch(req)
  },
  storage: {
    get: async (ns: string, key: string) => storageGet(ns, key),
    put: async (entry: Parameters<HostBindings['storage']['put']>[0]) => storagePut(entry),
    delete: async (ns: string, key: string) => storageDelete(ns, key),
    list: async (ns: string) => storageList(ns, null)
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
