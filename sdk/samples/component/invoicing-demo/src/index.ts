import './polyfill';

import type { ContextData, ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';
import { handler as userHandler } from './handler';

// Raw imports from the WIT world
// @ts-ignore
import { getContext } from 'alga:extension/context';
// @ts-ignore
import { logInfo, logWarn, logError } from 'alga:extension/logging';
// @ts-ignore
import { callRoute as uiProxyCall } from 'alga:extension/ui-proxy';
// @ts-ignore
import { createManualInvoice as createManualInvoiceWit } from 'alga:extension/invoicing';

const host: HostBindings = {
  context: {
    get: async () => getContext() as unknown as ContextData,
  },
  secrets: {
    get: async () => {
      throw new Error('secrets.get not available (cap:secrets.get not granted)');
    },
    list: async () => [],
  },
  http: {
    fetch: async () => {
      throw new Error('http.fetch not available (cap:http.fetch not granted)');
    },
  },
  storage: {
    get: async () => null,
    put: async () => {
      throw new Error('storage.put not available (cap:storage.kv not granted)');
    },
    delete: async () => {
      throw new Error('storage.delete not available (cap:storage.kv not granted)');
    },
    list: async () => [],
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
    list: async () => [],
    get: async () => null,
    create: async () => {
      throw new Error('scheduler.create not available (cap:scheduler.manage not granted)');
    },
    update: async () => {
      throw new Error('scheduler.update not available (cap:scheduler.manage not granted)');
    },
    delete: async () => {
      throw new Error('scheduler.delete not available (cap:scheduler.manage not granted)');
    },
    getEndpoints: async () => [],
  },
  invoicing: {
    createManualInvoice: async (input) => createManualInvoiceWit(input),
  },
  user: {
    getUser: async () => {
      throw new Error('user.getUser not available (cap:user.read not granted)');
    },
  },
};

// The export required by the WIT world (runner): handler(request) -> response
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}

