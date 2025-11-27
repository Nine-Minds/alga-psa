import './polyfill.js';
import { handler as userHandler } from './handler.js';
import {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ContextData
} from '@alga/extension-runtime';

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
        // We attempt to get context from the host. 
        // Note: The raw context might not match exactly the SDK context if WIT definitions differ.
        // We cast it for now.
        return getContext() as unknown as ContextData;
    }
  },
  secrets: {
    get: async (key: string) => getSecret(key),
    list: async () => listSecrets()
  },
  http: {
    fetch: async (req: any) => httpFetch(req)
  },
  storage: {
    get: async (ns: string, key: string) => storageGet(ns, key),
    put: async (entry: any) => storagePut(entry),
    delete: async (ns: string, key: string) => storageDelete(ns, key),
    list: async (ns: string) => storageList(ns, null)
  },
  logging: {
    info: async (msg: string) => logInfo(msg),
    warn: async (msg: string) => logWarn(msg),
    error: async (msg: string) => logError(msg)
  },
  uiProxy: {
    callRoute: async (route: string, payload: any) => uiProxyCall(route, payload)
  }
};

// The export required by the WIT world (runner)
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
