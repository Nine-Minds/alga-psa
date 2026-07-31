import { randomUUID } from 'node:crypto';

/**
 * The Entra/CIPP half of the emulator: managed tenants and their users.
 *
 * The inbound-email half of this emulator answers mailbox questions. The Entra
 * integration asks a different set — "which customer tenants does my partner
 * relationship cover, and who is in them" — over both Microsoft Graph and the
 * CIPP API. Both are served from one dataset here, so the same seeded MSP can
 * be walked through the wizard on either connection method and produce the same
 * clients and contacts.
 *
 * Nothing here is a fixture for a specific test. It is a directory you can point
 * a running Alga at.
 */

export const entraState = {
  /** The partner's own tenant, returned by /organization and used by /users. */
  organization: null,
  tenants: new Map(),
  users: new Map(),
  /** When set, CIPP requests must present this key; when null, any key passes. */
  cippApiKey: null,
};

export function resetEntra() {
  entraState.organization = null;
  entraState.tenants.clear();
  entraState.users.clear();
  entraState.cippApiKey = null;
}

function normalizeUser(input, tenantId) {
  const upn = String(input.userPrincipalName || input.upn || '').trim() || null;
  return {
    id: String(input.id || randomUUID()),
    tenantId: String(input.tenantId || tenantId || ''),
    displayName: input.displayName ?? null,
    givenName: input.givenName ?? null,
    surname: input.surname ?? null,
    // A real directory has accounts with no mailbox: mail null, UPN set.
    mail: input.mail === undefined ? upn : input.mail,
    userPrincipalName: upn,
    accountEnabled: input.accountEnabled === undefined ? true : Boolean(input.accountEnabled),
    jobTitle: input.jobTitle ?? null,
    mobilePhone: input.mobilePhone ?? null,
    businessPhones: Array.isArray(input.businessPhones) ? input.businessPhones : [],
  };
}

export function upsertTenant(input) {
  const tenantId = String(input.tenantId || input.id || randomUUID());
  const tenant = {
    tenantId,
    id: tenantId,
    displayName: input.displayName ?? null,
    defaultDomainName: input.defaultDomainName ?? input.primaryDomain ?? null,
    tenantStatusInformation: { deletedDateTime: null },
  };
  entraState.tenants.set(tenantId, tenant);
  return tenant;
}

export function upsertUser(input) {
  const user = normalizeUser(input, input.tenantId);
  if (!user.tenantId) {
    throw new Error('a user needs a tenantId');
  }
  entraState.users.set(user.id, user);
  return user;
}

function usersForTenant(tenantId) {
  return [...entraState.users.values()].filter((user) => user.tenantId === tenantId);
}

function tenantWithCounts(tenant) {
  return { ...tenant, userCount: usersForTenant(tenant.tenantId).length };
}

/**
 * One MSP with three customer tenants, sized so the preflight buckets are all
 * reachable: people who will be created, one account already disabled (so
 * "mark inactive" is not always zero), and a user with no mailbox (so the
 * no-email path is exercised rather than assumed).
 */
export function seedMspPreset() {
  resetEntra();

  entraState.organization = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Delgado IT',
    verifiedDomains: [
      { name: 'delgado-it.com', isDefault: true, isInitial: false },
      { name: 'delgadoit.onmicrosoft.com', isDefault: false, isInitial: true },
    ],
  };

  const tenants = [
    {
      tenantId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Contoso Ltd',
      defaultDomainName: 'contoso.com',
      users: [
        { displayName: 'Ada Lovelace', givenName: 'Ada', surname: 'Lovelace', mail: 'ada.lovelace@contoso.com', jobTitle: 'Operations Director', mobilePhone: '+1 555 0100' },
        { displayName: 'Grace Hopper', givenName: 'Grace', surname: 'Hopper', mail: 'grace.hopper@contoso.com', jobTitle: 'Finance Manager', businessPhones: ['+1 555 0101'] },
        { displayName: 'Alan Turing', givenName: 'Alan', surname: 'Turing', mail: 'alan.turing@contoso.com', jobTitle: 'IT Lead' },
        { displayName: 'Katherine Johnson', givenName: 'Katherine', surname: 'Johnson', mail: 'katherine.johnson@contoso.com', jobTitle: 'Office Manager' },
        // Left the company: still in the directory, account disabled.
        { displayName: 'Charles Babbage', givenName: 'Charles', surname: 'Babbage', mail: 'charles.babbage@contoso.com', jobTitle: 'Consultant', accountEnabled: false },
        // Service account with no mailbox.
        { displayName: 'Contoso Scanner', userPrincipalName: 'scanner@contoso.com', mail: null },
      ],
    },
    {
      tenantId: '33333333-3333-4333-8333-333333333333',
      displayName: 'Northwind Traders',
      defaultDomainName: 'northwindtraders.com',
      users: [
        { displayName: 'Jordan Lee', givenName: 'Jordan', surname: 'Lee', mail: 'jordan.lee@northwindtraders.com', jobTitle: 'Owner', mobilePhone: '+1 555 0200' },
        { displayName: 'Priya Raman', givenName: 'Priya', surname: 'Raman', mail: 'priya.raman@northwindtraders.com', jobTitle: 'Warehouse Supervisor' },
        { displayName: 'Tom Okafor', givenName: 'Tom', surname: 'Okafor', mail: 'tom.okafor@northwindtraders.com', jobTitle: 'Driver' },
        { displayName: 'Sofia Marino', givenName: 'Sofia', surname: 'Marino', mail: 'sofia.marino@northwindtraders.com', jobTitle: 'Accounts Payable', accountEnabled: false },
      ],
    },
    {
      tenantId: '44444444-4444-4444-8444-444444444444',
      displayName: 'Fabrikam Residential',
      defaultDomainName: 'fabrikam-res.com',
      users: [
        { displayName: 'Wei Chen', givenName: 'Wei', surname: 'Chen', mail: 'wei.chen@fabrikam-res.com', jobTitle: 'Managing Director' },
        { displayName: 'Ana Silva', givenName: 'Ana', surname: 'Silva', mail: 'ana.silva@fabrikam-res.com', jobTitle: 'Property Manager', mobilePhone: '+1 555 0300' },
        { displayName: 'Ben Okonkwo', givenName: 'Ben', surname: 'Okonkwo', mail: 'ben.okonkwo@fabrikam-res.com', jobTitle: 'Maintenance Lead' },
      ],
    },
  ];

  for (const spec of tenants) {
    upsertTenant(spec);
    for (const user of spec.users) {
      upsertUser({ ...user, tenantId: spec.tenantId });
    }
  }

  // The partner's own staff, so self-tenant smoke mode has something to read.
  upsertUser({ tenantId: entraState.organization.id, displayName: 'Sam Delgado', givenName: 'Sam', surname: 'Delgado', mail: 'sam@delgado-it.com', jobTitle: 'Owner' });
  upsertUser({ tenantId: entraState.organization.id, displayName: 'Rae Mbeki', givenName: 'Rae', surname: 'Mbeki', mail: 'rae@delgado-it.com', jobTitle: 'Service Desk' });

  return summarizeEntra();
}

export function summarizeEntra() {
  return {
    organization: entraState.organization,
    tenants: [...entraState.tenants.values()].map(tenantWithCounts),
    userCount: entraState.users.size,
    cippApiKeyPinned: Boolean(entraState.cippApiKey),
  };
}

/** `$filter=tenantId eq 'x'` is the only filter the adapter sends. */
function tenantIdFromFilter(filter) {
  const match = /tenantId\s+eq\s+'([^']*)'/i.exec(filter || '');
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Graph pages with an opaque token. The adapters follow `@odata.nextLink` until
 * it stops appearing, so paging here is what proves they do.
 */
function pagedResponse(rows, url, top) {
  const size = Number.isFinite(top) && top > 0 ? Math.min(top, 999) : 100;
  const skip = Number(url.searchParams.get('$skiptoken') || 0) || 0;
  const page = rows.slice(skip, skip + size);
  const payload = { value: page };

  if (skip + size < rows.length) {
    const next = new URL(url.toString());
    next.searchParams.set('$skiptoken', String(skip + size));
    payload['@odata.nextLink'] = next.toString();
  }

  return payload;
}

/**
 * Graph endpoints the Entra integration reads. Returns true when handled, so
 * the caller can fall through to the mail surface.
 */
export function handleEntraGraph(req, res, graphPath, url, json) {
  const top = Number(url.searchParams.get('$top') || 0);

  if (req.method === 'GET' && graphPath === '/tenantRelationships/managedTenants/tenants') {
    const rows = [...entraState.tenants.values()].map(tenantWithCounts);
    json(res, 200, pagedResponse(rows, url, top));
    return true;
  }

  if (req.method === 'GET' && graphPath === '/tenantRelationships/managedTenants/users') {
    const tenantId = tenantIdFromFilter(url.searchParams.get('$filter'));
    const rows = tenantId ? usersForTenant(tenantId) : [...entraState.users.values()];
    json(res, 200, pagedResponse(rows, url, top));
    return true;
  }

  if (req.method === 'GET' && graphPath === '/organization') {
    json(res, 200, { value: entraState.organization ? [entraState.organization] : [] });
    return true;
  }

  if (req.method === 'GET' && graphPath === '/users') {
    const rows = entraState.organization
      ? usersForTenant(entraState.organization.id)
      : [...entraState.users.values()];
    json(res, 200, pagedResponse(rows, url, top));
    return true;
  }

  return false;
}

function cippAuthorized(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const apiKey = String(req.headers['x-api-key'] || '').trim();
  const presented = apiKey || bearer;
  if (!presented) return false;
  return entraState.cippApiKey ? presented === entraState.cippApiKey : true;
}

/** The CIPP-API surface, over the same directory. */
export function handleCippApi(req, res, url, json) {
  if (!url.pathname.startsWith('/api/')) {
    return false;
  }

  if (!cippAuthorized(req)) {
    json(res, 401, { error: 'Unauthorized', message: 'A valid CIPP API key is required.' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/listtenants') {
    json(res, 200, [...entraState.tenants.values()].map((tenant) => {
      const withCounts = tenantWithCounts(tenant);
      return {
        customerId: withCounts.tenantId,
        tenantId: withCounts.tenantId,
        displayName: withCounts.displayName,
        defaultDomainName: withCounts.defaultDomainName,
        userCount: withCounts.userCount,
      };
    }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/listusers') {
    const tenantId = url.searchParams.get('tenantId') || url.searchParams.get('TenantFilter');
    json(res, 200, usersForTenant(String(tenantId || '')).map((user) => ({
      id: user.id,
      tenantId: user.tenantId,
      displayName: user.displayName,
      givenName: user.givenName,
      surname: user.surname,
      mail: user.mail,
      userPrincipalName: user.userPrincipalName,
      accountEnabled: user.accountEnabled,
      jobTitle: user.jobTitle,
      mobilePhone: user.mobilePhone,
      businessPhones: user.businessPhones,
    })));
    return true;
  }

  // CIPP deployments differ; anything else is a 404 the adapter falls back from.
  json(res, 404, { error: 'NotFound', message: url.pathname });
  return true;
}

/** Control endpoints for seeding and mutating the directory. */
export async function handleEntraControl(req, res, url, readBody, json) {
  if (!url.pathname.startsWith('/__control/entra')) {
    return false;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/reset') {
    resetEntra();
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/seed') {
    json(res, 201, seedMspPreset());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/organization') {
    const input = await readBody(req);
    entraState.organization = {
      id: String(input.id || randomUUID()),
      displayName: input.displayName ?? null,
      verifiedDomains: Array.isArray(input.verifiedDomains) ? input.verifiedDomains : [],
    };
    json(res, 201, entraState.organization);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/tenants') {
    const input = await readBody(req);
    const tenant = upsertTenant(input);
    if (Array.isArray(input.users)) {
      for (const user of input.users) {
        upsertUser({ ...user, tenantId: tenant.tenantId });
      }
    }
    json(res, 201, tenantWithCounts(tenant));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/users') {
    const input = await readBody(req);
    json(res, 201, upsertUser(input));
    return true;
  }

  // Offboarding, the thing that makes a contact inactive on the next sync.
  if (req.method === 'POST' && url.pathname === '/__control/entra/users/disable') {
    const input = await readBody(req);
    const needle = String(input.id || input.mail || input.userPrincipalName || '').toLowerCase();
    const enabled = input.accountEnabled === undefined ? false : Boolean(input.accountEnabled);
    let changed = 0;
    for (const user of entraState.users.values()) {
      const matches = [user.id, user.mail, user.userPrincipalName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === needle);
      if (matches) {
        user.accountEnabled = enabled;
        changed += 1;
      }
    }
    json(res, 200, { ok: changed > 0, changed, accountEnabled: enabled });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/__control/entra/cipp-key') {
    const input = await readBody(req);
    entraState.cippApiKey = input.apiKey ? String(input.apiKey) : null;
    json(res, 200, { ok: true, pinned: Boolean(entraState.cippApiKey) });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/__control/entra/state') {
    json(res, 200, summarizeEntra());
    return true;
  }

  json(res, 404, { error: 'unknown_control_endpoint' });
  return true;
}
