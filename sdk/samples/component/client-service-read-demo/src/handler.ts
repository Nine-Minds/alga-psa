import type {
  ClientsListResult,
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ServicesListResult,
} from '../../../../extension-runtime/src/index.ts'

const encoder = new TextEncoder()

function jsonResponse(body: unknown, status = 200): ExecuteResponse {
  return {
    status,
    headers: [{ name: 'content-type', value: 'application/json' }],
    body: encoder.encode(JSON.stringify(body)),
  }
}

async function readSummary(host: HostBindings): Promise<{ clients: ClientsListResult; services: ServicesListResult }> {
  const [clients, services] = await Promise.all([
    host.clients.list({ page: 1, pageSize: 10, includeInactive: false }),
    host.services.list({ page: 1, pageSize: 10, itemKind: 'service' }),
  ])

  return { clients, services }
}

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method
  const url = request.http.url || '/'

  if (method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  if (url.startsWith('/api/clients')) {
    const clients = await host.clients.list({ page: 1, pageSize: 10, includeInactive: false })
    return jsonResponse({ clients })
  }

  if (url.startsWith('/api/services')) {
    const services = await host.services.list({ page: 1, pageSize: 10, itemKind: 'service' })
    return jsonResponse({ services })
  }

  if (url.startsWith('/api/summary') || url.startsWith('/api/ui-proxy/summary')) {
    const summary = await readSummary(host)
    let userId: string | null = null
    try {
      const user = await host.user.getUser()
      userId = user.userId
    } catch {
      userId = null
    }
    return jsonResponse({ ...summary, userId })
  }

  return jsonResponse({ error: 'not_found' }, 404)
}
