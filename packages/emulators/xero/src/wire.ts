import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import type { HostEnv } from '@alga-psa/emulator-host';
import { XeroWireError } from './core';
import type { XeroEmulatorCore } from './core';

/**
 * Vendor surface mirroring the three Xero hosts on one port: identity
 * authorize (GET /identity/connect/authorize), the token endpoint
 * (POST /connect/token), the connections list (GET /connections), and the
 * accounting API (/api.xro/2.0/...). Point XERO_OAUTH_AUTHORIZE_URL,
 * XERO_OAUTH_TOKEN_URL, XERO_CONNECTIONS_URL, and XERO_API_BASE_URL here.
 */
export function wire(router: Router, core: XeroEmulatorCore, _env: HostEnv): void {
  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  router.get('/identity/connect/authorize', (req, res) => {
    const query = Object.fromEntries(
      Object.entries(req.query).map(([key, value]) => [key, String(value)]),
    );
    const { redirectUri, code, state } = core.authorize(query);
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (state) {
      callback.searchParams.set('state', state);
    }
    res.redirect(302, callback.toString());
  });

  // Client credentials arrive either as HTTP Basic or in the form body (the
  // Alga client sends them in the body); the emulator accepts both.
  router.post('/connect/token', (req, res) => {
    const params = { ...(req.body ?? {}) };
    if (req.headers.authorization) {
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization);
      const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
      const separator = decoded.indexOf(':');
      const clientId = decoded.slice(0, separator);
      if (separator < 1 || (params.client_id && params.client_id !== clientId)) {
        throw new XeroWireError(401, { error: 'invalid_client' });
      }
      params.client_id = clientId;
      params.client_secret = decoded.slice(separator + 1);
    }
    res.json(core.grantToken(params));
  });

  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    res.locals.access = core.authenticate(bearer);
    next();
  };

  router.get('/connections', authenticate, (_req, res) => {
    res.json(core.connections(res.locals.access.clientId));
  });

  const api = express.Router();
  router.use('/api.xro/2.0', api);

  api.use(authenticate);
  api.use((req, res, next) => {
    const xeroTenantId = String(req.headers['xero-tenant-id'] ?? '');
    core.assertConnection(res.locals.access.clientId, xeroTenantId);
    res.locals.xeroTenantId = xeroTenantId;
    next();
  });

  api.get('/Accounts', (_req, res) => res.json({ Accounts: core.accounts() }));
  api.get('/TaxRates', (_req, res) => res.json({ TaxRates: core.taxRates() }));
  api.get('/Items', (_req, res) => res.json({ Items: core.items() }));
  api.get('/TrackingCategories', (_req, res) => res.json({ TrackingCategories: core.trackingCategories() }));

  const upsertInvoices = (req: Request, res: Response) => {
    const payloads = Array.isArray(req.body?.Invoices) ? req.body.Invoices : [];
    if (payloads.length === 0) {
      throw new XeroWireError(400, {
        Type: 'ValidationException',
        Title: 'A validation exception occurred',
        Status: 400,
        Detail: 'Request body must contain an Invoices array',
      });
    }
    const invoices = payloads.map((payload: Record<string, unknown>) =>
      core.upsertInvoice(String(res.locals.xeroTenantId), payload),
    );
    res.json({ Invoices: invoices });
  };
  api.post('/Invoices', upsertInvoices);
  api.put('/Invoices', upsertInvoices);

  api.get('/Invoices/:invoiceId', (req, res) => {
    res.json({ Invoices: [core.getInvoice(String(res.locals.xeroTenantId), String(req.params.invoiceId))] });
  });

  api.get('/Contacts', (req, res) => {
    const where = req.query.where === undefined ? undefined : String(req.query.where);
    res.json({ Contacts: core.queryContacts(String(res.locals.xeroTenantId), where) });
  });

  api.post('/Contacts', (req, res) => {
    const payloads = Array.isArray(req.body?.Contacts) ? req.body.Contacts : [];
    if (payloads.length === 0) {
      throw new XeroWireError(400, {
        Type: 'ValidationException',
        Title: 'A validation exception occurred',
        Status: 400,
        Detail: 'Request body must contain a Contacts array',
      });
    }
    const contacts = payloads.map((payload: Record<string, unknown>) =>
      core.upsertContact(String(res.locals.xeroTenantId), payload),
    );
    res.json({ Contacts: contacts });
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof XeroWireError) {
      if (err.status === 400 && err.body.Type === 'ValidationException') {
        res.status(400).json({
          ErrorNumber: 10,
          Type: 'ValidationException',
          Message: 'A validation exception occurred',
          Elements: Array.isArray(err.body.Elements) ? err.body.Elements : [{
            ValidationErrors: [{ Message: String(err.body.Detail ?? err.message) }],
          }],
        });
        return;
      }
      res.status(err.status).json(err.body);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
}
