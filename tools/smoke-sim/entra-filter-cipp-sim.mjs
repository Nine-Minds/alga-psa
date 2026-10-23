// Smoke-only CIPP simulator for the Entra user-import filters (alga-2026-0002578).
// Wraps test-harness/graph-emulator's CIPP surface and adds the Graph beta user
// fields real CIPP ListUsers returns but the emulator omits: userType and
// assignedLicenses. Object IDs match the contacts already linked in the
// alga-psa-local-test database so the sync links rather than duplicates.
import http from 'node:http';
import {
  entraState, handleCippApi, handleEntraControl, resetEntra, upsertGroup, upsertTenant, upsertUser,
} from '../../test-harness/graph-emulator/entra.mjs';

const port = Number(process.env.PORT || 4010);
const host = process.env.HOST || '127.0.0.1';
const extra = new Map(); // user id -> { userType?, assignedLicenses? }
const LIC = [{ skuId: 'c42b9cae-ea4f-4ab7-9717-81576235ccac', disabledPlans: [] }];

function seed() {
  resetEntra();
  entraState.organization = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Delgado IT', verifiedDomains: [{ name: 'delgado-it.com', isDefault: true }] };
  const add = (tenantId, u, x) => { upsertUser({ ...u, tenantId }); if (x) extra.set(u.id, x); };
  const member = { userType: 'Member', assignedLicenses: LIC };

  const contoso = '22222222-2222-4222-8222-222222222222';
  upsertTenant({ tenantId: contoso, displayName: 'Contoso Ltd', defaultDomainName: 'contoso.com' });
  add(contoso, { id: 'aaaaaaaa-0000-4000-8000-00000000000a', displayName: 'Ada Lovelace', givenName: 'Ada', surname: 'Lovelace', mail: 'ada.lovelace@contoso.com' }, member);
  add(contoso, { id: '3984cc65-f558-4c5a-9a44-9be3651b9007', displayName: 'Grace Hopper', givenName: 'Grace', surname: 'Hopper', mail: 'grace.hopper@contoso.com' }, member);
  add(contoso, { id: '08edcc29-64c2-40ff-9d31-d1957ab2fc05', displayName: 'Alan Turing', givenName: 'Alan', surname: 'Turing', mail: 'alan.turing@contoso.com' }, member);
  add(contoso, { id: '4be8c9ee-8822-4f57-b10d-59ec9ed3943d', displayName: 'Katherine Johnson', givenName: 'Katherine', surname: 'Johnson', mail: 'katherine.johnson@contoso.com' }, member);
  add(contoso, { id: 'bda65f29-20c7-488f-b784-96633cd281ff', displayName: 'Contoso Scanner', userPrincipalName: 'scanner@contoso.com', mail: null }, { userType: 'Member', assignedLicenses: [] });

  const nw = '33333333-3333-4333-8333-333333333333';
  upsertTenant({ tenantId: nw, displayName: 'Northwind Traders', defaultDomainName: 'northwindtraders.com' });
  const jordan = 'e2d93eff-c2a4-4db8-ab05-fa6811da0dc4', priya = '1f6d7ae4-6262-44bc-afc5-7c1eededd64b', tom = '6f5067f9-a802-4113-b53a-b9b3c65f0ec1';
  const lena = 'bbbbbbbb-0000-4000-8000-00000000000b', kiosk = 'cccccccc-0000-4000-8000-00000000000c', sofia = 'dddddddd-0000-4000-8000-00000000000d';
  add(nw, { id: jordan, displayName: 'Jordan Lee', givenName: 'Jordan', surname: 'Lee', mail: 'jordan.lee@northwindtraders.com', jobTitle: 'Owner' }, member);
  add(nw, { id: priya, displayName: 'Priya Raman', givenName: 'Priya', surname: 'Raman', mail: 'priya.raman@northwindtraders.com' }, member);
  // Member without a license: excluded by "Licensed users only".
  add(nw, { id: tom, displayName: 'Tom Okafor', givenName: 'Tom', surname: 'Okafor', mail: 'tom.okafor@northwindtraders.com' }, { userType: 'Member', assignedLicenses: [] });
  // B2B guest with a license: excluded by "Members only".
  add(nw, { id: lena, displayName: 'Lena Vendor (Guest)', givenName: 'Lena', surname: 'Vendor', mail: 'lena@partner.example', userPrincipalName: 'lena_partner.example#EXT#@northwindtraders.onmicrosoft.com' }, { userType: 'Guest', assignedLicenses: LIC });
  // Provider did not return userType/assignedLicenses: kept, counted as unknown.
  add(nw, { id: kiosk, displayName: 'Front Desk Kiosk', givenName: 'Front', surname: 'Desk', mail: 'frontdesk@northwindtraders.com' }, null);
  add(nw, { id: sofia, displayName: 'Sofia Marino', givenName: 'Sofia', surname: 'Marino', mail: 'sofia.marino@northwindtraders.com', accountEnabled: false }, member);
  const shared = 'abababab-0000-4000-8000-00000000000a';
  add(nw, { id: shared, displayName: 'Shared Mailbox', mail: 'shared@northwindtraders.com', accountEnabled: false }, { userType: 'Member', assignedLicenses: [] });
  upsertGroup({ id: '77777777-7777-4777-8777-777777777777', tenantId: nw, displayName: 'NW Staff', memberIds: [jordan, priya, tom] });
  upsertGroup({ id: '88888888-8888-4888-8888-888888888888', tenantId: nw, displayName: 'NW Contractors', memberIds: [lena, kiosk] });
  upsertGroup({ id: '99999999-9999-4999-8999-999999999999', tenantId: nw, displayName: 'All Users', memberIds: [jordan, priya, tom, lena, kiosk, sofia] });
  upsertGroup({ id: 'eeeeeeee-0000-4000-8000-00000000000e', tenantId: nw, displayName: 'NW Distribution', securityEnabled: false, memberIds: [jordan] });

  const fab = '44444444-4444-4444-8444-444444444444';
  upsertTenant({ tenantId: fab, displayName: 'Fabrikam Residential', defaultDomainName: 'fabrikam-res.com' });
  add(fab, { id: 'ffffffff-0000-4000-8000-00000000000f', displayName: 'Wei Chen', mail: 'wei.chen@fabrikam-res.com' }, member);
}
seed();

const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
const send = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[entra-filter-sim] ${req.method} ${url.pathname}${url.search}`);
  if (req.method === 'POST' && url.pathname === '/__control/sim/reseed') { seed(); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/__control/sim/user-extra') {
    const input = await readBody(req); extra.set(String(input.id), input.extra ?? null); return send(res, 200, { ok: true });
  }
  if (await handleEntraControl(req, res, url, readBody, send)) return;
  if (req.method === 'GET' && url.pathname.toLowerCase() === '/api/listmailboxes') {
    if (process.env.ENTRA_SIM_LISTMAILBOXES_403 === '1') return send(res, 403, { error: 'Exchange.Mailbox.Read required' });
    return send(res, 200, [{ externalDirectoryObjectId: 'abababab-0000-4000-8000-00000000000a', recipientTypeDetails: 'SharedMailbox' }]);
  }
  const json = url.pathname === '/api/listusers'
    ? (r, status, rows) => send(r, status, Array.isArray(rows) ? rows.map((row) => ({ ...row, ...(extra.get(row.id) || {}) })) : rows)
    : send;
  if (handleCippApi(req, res, url, json)) return;
  send(res, 404, { error: 'not_found' });
}).listen(port, host, () => console.log(`[entra-filter-sim] listening on ${host}:${port}`));
