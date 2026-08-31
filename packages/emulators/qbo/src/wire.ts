import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { QboSimError } from '@alga-psa/billing/testing/qboSimulator';
import { route } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import { QboWireError } from './core';
import type { QboEmulatorCore } from './core';

const ENTITY_PATHS: Record<string, string> = {
  customer: 'Customer',
  invoice: 'Invoice',
  creditmemo: 'CreditMemo',
  payment: 'Payment',
};

function entityTypeFromPath(pathSegment: string): string {
  const entityType = ENTITY_PATHS[pathSegment.toLowerCase()];
  if (!entityType) {
    throw new QboWireError(400, 'SIM_UNSUPPORTED', `QBO emulator does not model entity path "${pathSegment}"`);
  }
  return entityType;
}

function parseBasicAuth(req: Request): { clientId: string; clientSecret: string } {
  const header = String(req.headers.authorization ?? '');
  if (!header.startsWith('Basic ')) {
    throw new QboWireError(401, '3200', 'invalid_client: Basic authorization required');
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
}

/**
 * Vendor surface mirroring the three Intuit hosts on one port:
 * appcenter authorize (GET /connect/oauth2), the OAuth token endpoint
 * (POST /oauth2/v1/tokens/bearer), and the v3 accounting API
 * (/v3/company/:realmId/...). Point QBO_OAUTH_AUTHORIZE_URL,
 * QBO_OAUTH_TOKEN_URL, and QBO_API_BASE_URL here.
 */
export function wire(router: Router, core: QboEmulatorCore, _env: HostEnv): void {
  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  router.get('/connect/oauth2', (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) {
      throw new QboWireError(400, '3200', 'client_id and redirect_uri are required');
    }
    const code = core.authorize(clientId, redirectUri);
    // Intuit's company picker equivalent: ?realmId=... on the request, else the
    // control-selected company, else the default realm. Must be a known realm.
    const chosenRealm = req.query.realmId
      ? String(req.query.realmId)
      : core.authorizeRealmId ?? core.realmId;
    core.simFor(chosenRealm);
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('realmId', chosenRealm);
    if (req.query.state) {
      callback.searchParams.set('state', String(req.query.state));
    }
    res.redirect(302, callback.toString());
  });

  router.post('/oauth2/v1/tokens/bearer', (req, res) => {
    const { clientId, clientSecret } = parseBasicAuth(req);
    res.json(core.grantToken(clientId, clientSecret, req.body ?? {}));
  });

  const company = express.Router({ mergeParams: true });
  router.use('/v3/company/:realmId', company);

  company.use((req, res, next) => {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    res.locals.access = core.authenticate(bearer);
    // Throws the Intuit-shaped 403 when the realm has no company file.
    res.locals.sim = core.simFor(String(req.params.realmId));
    next();
  });

  const simOf = (res: Response) => res.locals.sim as QboEmulatorCore['sim'];

  company.get('/query', route(async (req, res) => {
    const selectQuery = String(req.query.query ?? '');
    if (/FROM\s+Preferences/i.test(selectQuery)) {
      res.json({ QueryResponse: { Preferences: [await simOf(res).client.getPreferences()] } });
      return;
    }
    const rows = await simOf(res).client.query(selectQuery);
    if (rows.length === 0) {
      res.json({ QueryResponse: {} });
      return;
    }
    const entityMatch = selectQuery.match(/FROM\s+(\w+)/i);
    res.json({ QueryResponse: { [entityMatch![1]]: rows } });
  }));

  company.get('/companyinfo/:companyId', (req, res) => {
    const realmId = String((req.params as Record<string, string>).realmId);
    res.json({
      CompanyInfo: {
        Id: realmId,
        CompanyName: `Alga Emulated Co (${realmId})`,
        Country: 'US',
        CompanyStartDate: '2020-01-01',
      },
    });
  });

  company.get('/cdc', route(async (req, res) => {
    const since = String(req.query.changedSince ?? new Date(0).toISOString());
    const { changes } = await simOf(res).client.fetchChanges(since);
    const grouped: Record<string, unknown[]> = {};
    for (const change of changes) {
      const row = change.deleted ? { Id: change.externalId, status: 'Deleted' } : change.payload;
      (grouped[change.entityType] ??= []).push(row);
    }
    res.json({ CDCResponse: [{ QueryResponse: [grouped] }] });
  }));

  company.get('/:entityPath/:id', route(async (req, res) => {
    const entityType = entityTypeFromPath(String(req.params.entityPath));
    const entity = await simOf(res).client.read(entityType, String(req.params.id));
    if (!entity || (entity as { deleted?: boolean }).deleted) {
      throw new QboWireError(400, '610', `Object Not Found: ${entityType} ${req.params.id}`);
    }
    res.json({ [entityType]: entity });
  }));

  company.post('/:entityPath', route(async (req, res) => {
    const entityType = entityTypeFromPath(String(req.params.entityPath));
    const operation = String(req.query.operation ?? 'create');
    const body = req.body ?? {};

    if (operation === 'create') {
      res.json({ [entityType]: await simOf(res).client.create(entityType, body) });
      return;
    }
    if (operation === 'update') {
      res.json({ [entityType]: await simOf(res).client.update(entityType, body) });
      return;
    }
    if (operation === 'void' && entityType === 'Invoice') {
      res.json({ [entityType]: await simOf(res).client.voidInvoice(String(body.Id), String(body.SyncToken)) });
      return;
    }
    if (operation === 'delete' && entityType === 'CreditMemo') {
      res.json({ [entityType]: await simOf(res).client.deleteCreditMemo(String(body.Id), String(body.SyncToken)) });
      return;
    }
    throw new QboWireError(400, 'SIM_UNSUPPORTED', `Unsupported operation "${operation}" on ${entityType}`);
  }));

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof QboWireError) {
      res.status(err.status).json(err.toFault());
      return;
    }
    if (err instanceof QboSimError) {
      const wire = new QboWireError(400, err.code, err.message);
      res.status(wire.status).json(wire.toFault());
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
}
