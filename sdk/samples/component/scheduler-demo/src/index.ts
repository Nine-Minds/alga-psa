import './polyfill';

import type { ContextData, ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';
import { handler as userHandler } from './handler';

// Raw imports from the WIT world
// @ts-ignore
import { getContext } from 'alga:extension/context';
// @ts-ignore
import { get as getSecret, listKeys as listSecretKeys } from 'alga:extension/secrets';
// @ts-ignore
import { fetch as httpFetch } from 'alga:extension/http';
// @ts-ignore
import { get as storageGet, put as storagePut, delete as storageDelete, listEntries as storageList } from 'alga:extension/storage';
// @ts-ignore
import { logInfo, logWarn, logError } from 'alga:extension/logging';
// @ts-ignore
import { callRoute as uiProxyCall } from 'alga:extension/ui-proxy';
// @ts-ignore
import { getUser } from 'alga:extension/user-v2';
// @ts-ignore
import {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getEndpoints,
} from 'alga:extension/scheduler';

const host: HostBindings = {
  context: {
    get: async () => getContext() as unknown as ContextData,
  },
  secrets: {
    get: async (key: string) => getSecret(key),
    list: async () => listSecretKeys(),
  },
  http: {
    fetch: async (request: any) => httpFetch(request),
  },
  storage: {
    get: async (namespace: string, key: string) => storageGet(namespace, key),
    put: async (entry: any) => storagePut(entry),
    delete: async (namespace: string, key: string) => storageDelete(namespace, key),
    list: async (namespace: string) => storageList(namespace, null),
  },
  logging: {
    info: async (msg: string) => logInfo(msg),
    warn: async (msg: string) => logWarn(msg),
    error: async (msg: string) => logError(msg),
  },
  uiProxy: {
    callRoute: async (route: string, payload?: Uint8Array | null) => uiProxyCall(route, payload),
    call: async (route: string, payload?: Uint8Array | null) => uiProxyCall(route, payload),
  },
  scheduler: {
    list: async () => listSchedules(),
    get: async (scheduleId: string) => getSchedule(scheduleId),
    create: async (input: any) => createSchedule(input),
    update: async (scheduleId: string, input: any) => updateSchedule(scheduleId, input),
    delete: async (scheduleId: string) => deleteSchedule(scheduleId),
    getEndpoints: async () => getEndpoints(),
  },
  invoicing: {
    createManualInvoice: async () => {
      throw new Error('invoicing.createManualInvoice not available (cap:invoice.manual.create not granted)');
    },
  },
  user: {
    getUser: async () => getUser(),
  },
};

// Export required by the WIT world (runner): handler(request) -> response
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
