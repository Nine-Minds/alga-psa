# Client/Service Read Demo

Sample extension showing read-only host capability usage for:

- `host.clients.list(...)`
- `host.services.list(...)`

Endpoints:

- `GET /api/clients`
- `GET /api/services`
- `GET /api/summary`
- `GET /api/ui-proxy/summary`

The sample intentionally uses host capabilities directly and does not call `http.fetch` for these reads.
