import { handler as userHandler } from './handler-impl.js';
import {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ContextData,
  normalizeUserData,
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
// @ts-ignore
import { getUser as getUserV1 } from 'alga:extension/user';
// @ts-ignore
import { getUser as getUserV2 } from 'alga:extension/user-v2';

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
  },
  user: {
    getUser: async () => {
      try {
        return normalizeUserData(await getUserV2() as any);
      } catch {
        return normalizeUserData(await getUserV1() as any);
      }
    }
  },
  // Scheduler not used in this extension, but required by HostBindings
  scheduler: {
    list: async () => { throw new Error('scheduler not implemented'); },
    get: async () => { throw new Error('scheduler not implemented'); },
    create: async () => { throw new Error('scheduler not implemented'); },
    update: async () => { throw new Error('scheduler not implemented'); },
    delete: async () => { throw new Error('scheduler not implemented'); },
    getEndpoints: async () => { throw new Error('scheduler not implemented'); },
  }
};

// The export required by the WIT world (runner)
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
