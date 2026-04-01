import type {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
} from '../../../../extension-runtime/src/index.ts'

const encoder = new TextEncoder()

function jsonResponse(body: unknown, status = 200): ExecuteResponse {
  return {
    status,
    headers: [{ name: 'content-type', value: 'application/json' }],
    body: encoder.encode(JSON.stringify(body)),
  }
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

  return jsonResponse({ error: 'not_found' }, 404)
}
