import type {
  ContextData,
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
} from '@alga-psa/extension-runtime'
import { normalizeUserData } from '@alga-psa/extension-runtime'

import { handler as userHandler } from './handler.ts'

// @ts-ignore
import { getContext } from 'alga:extension/context'
// @ts-ignore
import { logInfo, logWarn, logError } from 'alga:extension/logging'
// @ts-ignore
import { callRoute as uiProxyCall } from 'alga:extension/ui-proxy'
// @ts-ignore
import { getUser } from 'alga:extension/user-v2'
// @ts-ignore
import { getClient, listClients } from 'alga:extension/clients'
// @ts-ignore
import { getService, listServices } from 'alga:extension/services'

const denied = (name: string) => async () => {
  throw new Error(`${name} not available for this extension`)
}

const host: HostBindings = {
  context: {
    get: async () => getContext() as unknown as ContextData,
  },
  secrets: {
    get: denied('secrets.get'),
    list: async () => [],
  },
  http: {
    fetch: denied('http.fetch'),
  },
  storage: {
    get: async () => null,
    put: denied('storage.put'),
    delete: denied('storage.delete'),
    list: async () => [],
  },
  logging: {
    info: async (message: string) => logInfo(message),
    warn: async (message: string) => logWarn(message),
    error: async (message: string) => logError(message),
  },
  uiProxy: {
    callRoute: async (route: string, payload?: Uint8Array | null) => uiProxyCall(route, payload),
    call: async (route: string, payload?: Uint8Array | null) => uiProxyCall(route, payload),
  },
  scheduler: {
    list: async () => [],
    get: async () => null,
    create: denied('scheduler.create'),
    update: denied('scheduler.update'),
    delete: denied('scheduler.delete'),
    getEndpoints: async () => [],
  },
  invoicing: {
    createManualInvoice: denied('invoicing.createManualInvoice'),
  },
  user: {
    getUser: async () => normalizeUserData(await getUser()),
  },
  clients: {
    list: async (input) => listClients(input ?? {}),
    get: async (clientId: string) => getClient(clientId),
  },
  services: {
    list: async (input) => listServices(input ?? {}),
    get: async (serviceId: string) => getService(serviceId),
  },
}

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host)
}
