// Local accounting-provider fault simulator for redaction smoke tests.
//
// Emulates the failure surfaces of the Xero and QuickBooks Online wire
// protocols and deliberately loads every error body with fixed sentinel
// secrets and PII (tokens, client secrets, Authorization headers, customer
// and invoice data). Point the app at it with the standard provider env
// overrides, drive an OAuth callback or export, then assert the sentinels
// never reach logs, persisted metadata, or API responses while status /
// stable code / correlation ID survive.
//
//   XERO_OAUTH_TOKEN_URL=http://localhost:8792/xero/connect/token
//   XERO_API_BASE_URL=http://localhost:8792/xero/api.xro/2.0
//   XERO_CONNECTIONS_URL=http://localhost:8792/xero/connections
//   QBO_OAUTH_TOKEN_URL=http://localhost:8792/qbo/oauth2/v1/tokens/bearer
//   QBO_API_BASE_URL=http://localhost:8792/qbo/v3/company
//
// Scenario selection: `?scenario=<name>` or `x-sim-scenario` header.
//   token-error (default for token endpoints)  → 400 OAuth error body
//   token-malformed                            → 200 body missing token fields
//   api-error (default for API endpoints)      → provider validation fault
//   api-500                                    → provider internal error
//
// Usage: node accounting-provider-sim.mjs [port]   (default 8792)

import http from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.ACCOUNTING_SIM_PORT ?? 8792);

export const SENTINELS = {
  accessToken: 'SIMSENTINEL-ACCESS-TOKEN-9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd',
  refreshToken: 'SIMSENTINEL-REFRESH-TOKEN-0a1b2c3d4e5f60718293a4b5c6d7e8f9deadbeef',
  clientSecret: 'SIMSENTINEL-CLIENT-SECRET-abcdef0123456789abcdef0123456789cafebabe',
  authHeader: 'Bearer SIMSENTINEL-AUTH-HEADER-fedcba9876543210fedcba9876543210feedface',
  authorizationCode: 'SIMSENTINEL-AUTH-CODE-1234567890abcdef1234567890abcdef12345678',
  customerName: 'SIMSENTINEL Customer Acme Ltd',
  invoiceNumber: 'INV-SIMSENTINEL-0042'
};

const XERO_CORRELATION_ID = 'xero-corr-sim-0001';
const QBO_INTUIT_TID = 'intuit-tid-sim-0001';

let requestCount = 0;

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  requestCount += 1;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const scenario =
    url.searchParams.get('scenario') || req.headers['x-sim-scenario'] || null;
  const rawBody = await readBody(req);
  console.log(
    `[accounting-sim] #${requestCount} ${req.method} ${url.pathname} scenario=${scenario ?? 'default'}`
  );

  // ---- Xero token exchange ------------------------------------------------
  if (url.pathname === '/xero/connect/token') {
    if (scenario === 'token-malformed') {
      // Success status, but the expected token fields are absent. The body
      // still carries secret material: the app must treat it as sensitive.
      return send(res, 200, { 'xero-correlation-id': XERO_CORRELATION_ID }, {
        token_type: 'Bearer',
        id_token: SENTINELS.accessToken,
        session_state: SENTINELS.refreshToken,
        echoed_client_secret: SENTINELS.clientSecret,
        echoed_request: rawBody
      });
    }
    return send(res, 400, { 'xero-correlation-id': XERO_CORRELATION_ID }, {
      error: 'invalid_grant',
      error_description: `Authorization code ${SENTINELS.authorizationCode} rejected for secret ${SENTINELS.clientSecret}`,
      access_token: SENTINELS.accessToken,
      refresh_token: SENTINELS.refreshToken,
      request_headers: { authorization: SENTINELS.authHeader },
      echoed_request: rawBody
    });
  }

  // ---- Xero connections ---------------------------------------------------
  if (url.pathname === '/xero/connections') {
    if (scenario === 'api-error') {
      return send(res, 403, { 'xero-correlation-id': XERO_CORRELATION_ID }, {
        Type: 'AuthorizationException',
        Message: `Token ${SENTINELS.accessToken} is not authorized`,
        request_headers: { authorization: SENTINELS.authHeader }
      });
    }
    return send(res, 200, { 'xero-correlation-id': XERO_CORRELATION_ID }, [
      {
        id: 'sim-connection-1',
        tenantId: 'sim-xero-tenant-1',
        tenantName: 'Sim Org'
      }
    ]);
  }

  // ---- Xero accounting API ------------------------------------------------
  if (url.pathname.startsWith('/xero/api.xro/2.0/')) {
    if (scenario === 'api-500') {
      return send(res, 500, { 'xero-correlation-id': XERO_CORRELATION_ID }, {
        Type: 'InternalServerException',
        Message: `Unhandled failure processing ${SENTINELS.invoiceNumber} for ${SENTINELS.customerName}`,
        request_headers: { authorization: SENTINELS.authHeader }
      });
    }
    return send(res, 400, { 'xero-correlation-id': XERO_CORRELATION_ID }, {
      Type: 'ValidationException',
      Message: 'A validation exception occurred',
      Elements: [
        {
          Contact: { Name: SENTINELS.customerName },
          InvoiceNumber: SENTINELS.invoiceNumber,
          ValidationErrors: [
            {
              // Customer/invoice sentinels live in the structural fields above
              // (which must be dropped wholesale); the message quotes a
              // token-shaped credential the message sanitizer must scrub.
              Message: `Account code is required; auth token ${SENTINELS.accessToken}`
            }
          ]
        }
      ],
      request_headers: { authorization: SENTINELS.authHeader }
    });
  }

  // ---- QBO token exchange -------------------------------------------------
  if (url.pathname === '/qbo/oauth2/v1/tokens/bearer') {
    if (scenario === 'token-malformed') {
      return send(res, 200, { intuit_tid: QBO_INTUIT_TID }, {
        token_type: 'bearer',
        x_refresh_token_expires_in: 8726400,
        stray_refresh_token: SENTINELS.refreshToken,
        echoed_client_secret: SENTINELS.clientSecret,
        echoed_request: rawBody
      });
    }
    return send(res, 400, { intuit_tid: QBO_INTUIT_TID }, {
      error: 'invalid_grant',
      error_description: `Refresh token ${SENTINELS.refreshToken} revoked for secret ${SENTINELS.clientSecret}`,
      access_token: SENTINELS.accessToken,
      request_headers: { authorization: SENTINELS.authHeader },
      echoed_request: rawBody
    });
  }

  // ---- QBO company API ----------------------------------------------------
  if (url.pathname.startsWith('/qbo/v3/company/')) {
    if (scenario === 'api-500') {
      return send(res, 500, { intuit_tid: QBO_INTUIT_TID }, {
        Fault: {
          Error: [
            {
              Message: 'Internal server error',
              Detail: `Failed persisting ${SENTINELS.invoiceNumber} for ${SENTINELS.customerName}; auth ${SENTINELS.authHeader}`,
              code: '10000'
            }
          ],
          type: 'SystemFault'
        },
        time: '2026-01-01T00:00:00.000Z'
      });
    }
    return send(res, 400, { intuit_tid: QBO_INTUIT_TID }, {
      Fault: {
        Error: [
          {
            Message: 'Business validation error',
            Detail: `Invoice ${SENTINELS.invoiceNumber} for ${SENTINELS.customerName} invalid; token ${SENTINELS.accessToken}`,
            code: '6000',
            element: 'Line'
          }
        ],
        type: 'ValidationFault'
      },
      time: '2026-01-01T00:00:00.000Z',
      request_headers: { authorization: SENTINELS.authHeader }
    });
  }

  // ---- Introspection ------------------------------------------------------
  if (url.pathname === '/sentinels') {
    return send(res, 200, {}, {
      sentinels: SENTINELS,
      correlation: { xero: XERO_CORRELATION_ID, qbo: QBO_INTUIT_TID }
    });
  }

  return send(res, 404, {}, { error: { message: 'not found' } });
});

server.listen(PORT, () => {
  console.log(`[accounting-sim] listening on http://localhost:${PORT}`);
});
