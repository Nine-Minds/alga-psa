import { test, expect, type Page, type Response } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupAuthSession } from './helpers/testSetup';

// Opt in against an owned development tenant. Fixtures touch only this ID namespace.
const tenant = process.env.PROJECT_SECURITY_TENANT;
const baseURL = process.env.BASE_URL || 'http://localhost:3859';
const id = (n: number) => `61713048-0000-4000-8000-${String(n).padStart(12, '0')}`;
const evidenceDir = process.env.PROJECT_SECURITY_EVIDENCE_DIR;
const canaries = ['PRIVATE-CLIENT-NOTES-3048', 'PRIVATE-TAX-3048', 'private3048@example.test', 'PRIVATE-ADDRESS-3048', 'PRIVATE-PROJECT-3048'];
let db: Knex;
const records = (table: string) => db(table).where({ tenant });

test.describe('Projects client quick view with real authorization and persistence', () => {
  test.skip(!tenant, 'Set PROJECT_SECURITY_TENANT to an owned development tenant.');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  test.beforeAll(async () => {
    db = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_ADMIN || process.env.DB_USER_SERVER, password: process.env.DB_PASSWORD_ADMIN || process.env.DB_PASSWORD_SERVER,
      database: process.env.DB_NAME_SERVER }, pool: { min: 0, max: 3 } });
    const template = await records('users').where({ email: process.env.PROJECT_SECURITY_TEMPLATE_USER_EMAIL || 'qa@emeraldcity.oz' }).first()
      ?? await records('users').where({ user_type: 'internal', is_inactive: false }).first();
    const permissions = await records('permissions').where({ msp: true }).select('permission_id', 'resource', 'action');
    const status = await records('statuses').where({ status_type: 'project', is_closed: false }).first();
    if (!template || !status) throw new Error('The test tenant needs an internal user and an open project status');
    for (const [label, n] of [['authorized', 101], ['readonly', 102], ['redacted', 103], ['noclient', 104]] as const) {
      await db('roles').insert({ tenant, role_id: id(n + 100), role_name: `QuickView3048 ${label}`, msp: true, client: false }).onConflict(['tenant', 'role_id']).merge();
      await db('users').insert({ tenant, user_id: id(n), username: `quickview3048-${label}`, email: `quickview3048-${label}@example.test`, first_name: 'QuickView3048', last_name: label,
        user_type: 'internal', is_inactive: false, auth_method: 'password', hashed_password: template.hashed_password, two_factor_enabled: false }).onConflict(['tenant', 'user_id']).merge();
      await db('user_preferences').insert({ tenant, user_id: id(n), setting_name: 'locale', setting_value: JSON.stringify('en') }).onConflict(['tenant', 'user_id', 'setting_name']).merge();
      await records('user_roles').where({ user_id: id(n) }).delete();
      await db('user_roles').insert({ tenant, user_id: id(n), role_id: id(n + 100) });
      await records('role_permissions').where({ role_id: id(n + 100) }).delete();
      const granted = permissions.filter(p => (label !== 'readonly' || p.action === 'read') && (label !== 'noclient' || p.resource !== 'client'));
      await db('role_permissions').insert(granted.map(p => ({ tenant, role_id: id(n + 100), permission_id: p.permission_id })));
    }
    await db('priorities').insert({ tenant, priority_id: id(33), priority_name: 'QuickView3048 Normal', item_type: 'ticket', order_number: 1 })
      .onConflict(['tenant', 'priority_id']).merge();
    await db('boards').insert({ tenant, board_id: id(31), board_name: 'QuickView3048 Support', priority_type: 'custom', default_priority_id: id(33), is_inactive: false })
      .onConflict(['tenant', 'board_id']).merge();
    await db('statuses').insert({ tenant, status_id: id(32), name: 'QuickView3048 New', status_type: 'ticket', board_id: id(31), order_number: 1, is_default: true, is_closed: false })
      .onConflict(['tenant', 'status_id']).merge();
    for (const n of [1, 2]) {
      await db('clients').insert({ tenant, client_id: id(n), client_name: `QuickView3048 ${n === 1 ? 'Allowed' : 'Excluded'} Client`, client_type: 'company', is_inactive: false,
        notes: canaries[0], tax_id_number: canaries[1], billing_email: canaries[2] }).onConflict(['tenant', 'client_id']).merge();
      await db('projects').insert({ tenant, project_id: id(n + 10), project_name: `QuickView3048 ${n === 1 ? 'Allowed' : 'Excluded'} Project`, project_number: `QV3048-${n}`,
        wbs_code: `QV3048-${n}`, client_id: id(n), status: status.status_id, description: canaries[4], budgeted_hours: 731, is_inactive: false }).onConflict(['tenant', 'project_id']).merge();
    }
    await db('client_locations').insert({ tenant, location_id: id(21), client_id: id(1), location_name: 'QuickView3048 HQ', address_line1: canaries[3], city: 'Tampa',
      country_code: 'US', country_name: 'United States', email: canaries[2], is_active: true, is_default: true }).onConflict(['tenant', 'location_id']).merge();
    // Actual published bundles run through the production authorization kernel.
    for (const n of [102, 103]) {
      const bundle = id(n + 200), revision = id(n + 300);
      await db('authorization_bundles').insert({ tenant, bundle_id: bundle, name: `QuickView3048 ${n}`, bundle_key: `quickview3048-${n}` }).onConflict(['tenant', 'bundle_id']).ignore();
      await db('authorization_bundle_revisions').insert({ tenant, bundle_id: bundle, revision_id: revision, revision_number: 1, lifecycle_state: 'published' }).onConflict(['tenant', 'revision_id']).ignore();
      await records('authorization_bundles').where({ bundle_id: bundle }).update({ published_revision_id: revision });
      for (const [offset, resource] of [[400, 'project'], [500, 'client']] as const) {
        await db('authorization_bundle_rules').insert({ tenant, rule_id: id(n + offset), bundle_id: bundle, revision_id: revision, resource_type: resource, action: 'read', template_key: 'selected_clients',
          constraint_key: resource === 'project' || n === 103 ? 'hide_sensitive_fields' : null,
          config: { selectedClientIds: [id(1)], redactedFields: resource === 'project' ? ['fields.description', 'fields.budgeted_hours']
            : n === 103 ? ['fields.notes', 'fields.tax_id_number', 'fields.email', 'fields.billing_email', 'fields.location_email', 'fields.location_address'] : [] } }).onConflict(['tenant', 'rule_id']).merge();
      }
      await db('authorization_bundle_assignments').insert({ tenant, assignment_id: id(n + 600), bundle_id: bundle, target_type: 'user', target_id: id(n) }).onConflict(['tenant', 'assignment_id']).ignore();
    }
    if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await writeFile(path.join(evidenceDir, 'quick-view-fixtures.json'), JSON.stringify({ tenant, users: [101, 102, 103, 104].map(id), clientId: id(1), projectId: id(11), locationId: id(21) }, null, 2)); }
  });
  test.afterAll(async () => { await db?.destroy(); });
  async function login(page: Page, n: number) {
    await page.context().clearCookies();
    const user = await records('users').where({ user_id: id(n) }).first();
    await setupAuthSession(page, { tenant: { tenantId: tenant!, tenantName: 'QuickView3048' }, adminUser: { userId: user.user_id, email: user.email } }, baseURL, db);
    await page.goto(`${baseURL}/msp/projects?searchQuery=QuickView3048`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    if (page.url().includes('/auth/')) throw new Error(`Fixture session rejected: ${page.url()}; cookies=${(await page.context().cookies()).map(cookie => cookie.name).join(',')}`);
    if (n !== 104) await expect(page.locator(`#project-client-summary-${id(11)}`)).toBeVisible({ timeout: 120_000 });
  }
  async function open(page: Page) {
    await page.locator(`#project-client-summary-${id(11)}`).click();
    await expect(page.locator('#client-name-field-input')).toBeVisible({ timeout: 90_000 });
  }
  async function capture(page: Page, name: string) {
    if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
  }
  // Resolve the running Next action registry, then exercise real HTTP authorization.
  async function action(page: Page, name: string, args: unknown[]) {
    const manifest = JSON.parse(await readFile(path.resolve(process.env.PROJECT_SECURITY_MANIFEST || '.next-dev/dev/server/app/msp/projects/page/server-reference-manifest.json'), 'utf8'));
    const entry = Object.entries(manifest.node).find(([, value]: [string, any]) => value.exportedName === name);
    if (!entry) throw new Error(`Running action is unavailable: ${name}`);
    const response = await page.request.post(`${baseURL}/msp/projects`, { headers: { 'Next-Action': entry[0], 'Content-Type': 'text/plain;charset=UTF-8', Origin: baseURL }, data: JSON.stringify(args) });
    return response.text();
  }
  test('authorized reader retains client editing, location management and ticket creation', async ({ page }) => {
    await login(page, 101); await open(page);
    for (const selector of ['#save-client-changes-btn', '#locations-button', '#add-ticket-btn']) await expect(page.locator(selector)).toBeEnabled();
    await capture(page, '11-authorized-full-quick-view');
    await page.locator('#client-name-field-input').fill('QuickView3048 Saved Client'); await page.locator('#client-name-field-input').press('Tab');
    await page.locator('#save-client-changes-btn').click();
    await expect.poll(async () => (await records('clients').where({ client_id: id(1) }).first()).client_name).toBe('QuickView3048 Saved Client');
    await page.locator('#locations-button').click(); await page.locator(`#edit-location-${id(21)}-button`).click();
    await page.locator('#location-name-input').fill('QuickView3048 Saved HQ'); await page.locator('#save-location-button').click();
    await expect.poll(async () => (await records('client_locations').where({ location_id: id(21) }).first()).location_name).toBe('QuickView3048 Saved HQ');
    await expect(page.getByRole('dialog', { name: 'Edit Location', exact: true })).toBeHidden();
    await capture(page, '12-authorized-manage-locations'); await page.getByRole('dialog', { name: 'Manage Locations', exact: true }).locator('[data-dialog-close-button]').click();
    await page.locator('#add-ticket-btn').click();
    const title = `QuickView3048 persisted ticket ${Date.now()}`;
    await page.locator('#client-drawer-details-quick-add-ticket-title').fill(title);
    await page.locator('#client-drawer-details-quick-add-ticket-board-picker').click();
    await page.locator(`#client-drawer-details-quick-add-ticket-board-picker-board-picker-board-${id(31)}`).click();
    await expect(page.locator('#client-drawer-details-quick-add-ticket[role=combobox]')).toContainText('QuickView3048 New');
    await page.locator('#client-drawer-details-quick-add-ticket-submit-btn').click();
    await expect.poll(async () => (await records('tickets').where({ title, client_id: id(1) }).first())?.ticket_id, { timeout: 60_000 }).toBeTruthy();
    await capture(page, '13-authorized-created-ticket'); await page.reload(); await open(page);
    await expect(page.locator('#client-name-field-input')).toHaveValue('QuickView3048 Saved Client');
  });
  test('reader without mutation capabilities is denied by both controls and server actions', async ({ page }) => {
    await login(page, 102); await open(page); await expect(page.locator('#client-name-field-input')).toBeDisabled();
    for (const selector of ['#save-client-changes-btn', '#locations-button', '#add-ticket-btn']) await expect(page.locator(selector)).toBeDisabled();
    await capture(page, '14-readonly-capabilities-denied');
    for (const [name, args] of [
      ['updateProjectClientQuickView', [id(1), { client_name: 'FORBIDDEN' }, id(11)]],
      ['updateProjectClientLocationQuickView', [id(1), id(21), { location_name: 'FORBIDDEN' }, id(11)]],
      ['mutateProjectClientLocationQuickView', [id(1), { kind: 'delete', locationId: id(21) }, id(11)]],
      ['addTicket', [{ title: 'FORBIDDEN', client_id: id(1) }]],
    ] as const) expect(await action(page, name, [...args])).toContain('Permission denied');
    expect((await records('clients').where({ client_id: id(1) }).first()).client_name).not.toBe('FORBIDDEN');
    expect((await records('client_locations').where({ location_id: id(21) }).first()).location_name).not.toBe('FORBIDDEN');
  });
  test('redacted client fields stay out of every drawer, location, save and ticket-form response', async ({ page }) => {
    const bodies: string[] = [], pending: Promise<unknown>[] = [];
    const inspect = (response: Response) => {
      if (response.url().startsWith(baseURL) && /text\/x-component|text\/html|application\/json/.test(response.headers()['content-type'] || ''))
        pending.push(response.text().then(body => bodies.push(body)).catch(() => undefined));
    };
    page.on('response', inspect); await login(page, 103); await open(page); await capture(page, '15-redacted-full-quick-view');
    await page.locator('#locations-button').click(); await page.locator(`#edit-location-${id(21)}-button`).click();
    await expect(page.locator('#address-line1-input')).toBeDisabled(); await expect(page.locator('#address-line1-input')).toHaveValue('');
    await page.locator('#location-name-input').fill('QuickView3048 Redacted Saved HQ'); await page.locator('#save-location-button').click();
    await expect.poll(async () => (await records('client_locations').where({ location_id: id(21) }).first()).location_name).toBe('QuickView3048 Redacted Saved HQ');
    await expect(page.getByRole('dialog', { name: 'Edit Location', exact: true })).toBeHidden();
    await capture(page, '16-redacted-location-edit'); await page.getByRole('dialog', { name: 'Manage Locations', exact: true }).locator('[data-dialog-close-button]').click();
    await page.locator('#client-name-field-input').fill('QuickView3048 Redacted Saved Client'); await page.locator('#client-name-field-input').press('Tab'); await page.locator('#save-client-changes-btn').click();
    await expect.poll(async () => (await records('clients').where({ client_id: id(1) }).first()).client_name).toBe('QuickView3048 Redacted Saved Client');
    await page.locator('#add-ticket-btn').click(); await expect(page.locator('#client-drawer-details-quick-add-ticket-title')).toBeVisible(); await capture(page, '17-redacted-ticket-form');
    await page.locator('#client-drawer-details-quick-add-ticket-location').click();
    await expect(page.getByRole('option', { name: /QuickView3048 Redacted Saved HQ/ })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const [name, args] of [['getProjects', []], ['loadProjectListItemsByIds', [[id(11), id(12)]]]] as const) {
      const body = await action(page, name, [...args]); expect(body).not.toContain(id(12)); expect(body).not.toContain(canaries[4]); expect(body).toContain('"budgeted_hours":null'); bodies.push(body);
    }
    bodies.push(await action(page, 'getAllClientsForProjects', [])); await Promise.all(pending);
    expect(bodies.length).toBeGreaterThan(5);
    for (const body of bodies) for (const secret of canaries) expect(body).not.toContain(secret);
    const client = await records('clients').where({ client_id: id(1) }).first(); expect(client.notes).toBe(canaries[0]); expect(client.tax_id_number).toBe(canaries[1]);
    const location = await records('client_locations').where({ location_id: id(21) }).first(); expect(location.address_line1).toBe(canaries[3]); expect(location.email).toBe(canaries[2]);
    if (evidenceDir) await writeFile(path.join(evidenceDir, 'quick-view-response-audit.json'), JSON.stringify({ responsesInspected: bodies.length, protectedCanariesAbsent: canaries, databaseValuesPreserved: true }, null, 2));
    page.off('response', inspect);
  });
  test('client-read denial blocks direct quick-view requests and returns an empty picker', async ({ page }) => {
    await login(page, 104);
    expect(await action(page, 'getProjectClientQuickView', [id(1), id(11)])).toContain('Permission denied');
    expect(await action(page, 'getAllClientsForProjects', [])).toContain('1:[]');
    await expect(page.locator(`#project-client-summary-${id(11)}`)).toHaveCount(0); await capture(page, '18-no-client-read');
  });
  test('location commands persist creation, default selection and deletion without returning records', async ({ page }) => {
    await login(page, 101);
    const locationName = `QuickView3048 Branch ${Date.now()}`;
    const created = await action(page, 'mutateProjectClientLocationQuickView', [id(1), { kind: 'create', data: {
      client_id: id(1), location_name: locationName, address_line1: '100 Public Test Road', city: 'Tampa',
      country_code: 'US', country_name: 'United States', is_active: true, is_default: false,
    } }, id(11)]);
    expect(created).not.toContain('"location_id"');
    const location = await records('client_locations').where({ client_id: id(1), location_name: locationName }).first();
    expect(location).toBeTruthy();
    await action(page, 'mutateProjectClientLocationQuickView', [id(1), { kind: 'setDefault', locationId: location.location_id }, id(11)]);
    expect((await records('client_locations').where({ location_id: location.location_id }).first()).is_default).toBe(true);
    await action(page, 'mutateProjectClientLocationQuickView', [id(1), { kind: 'setDefault', locationId: id(21) }, id(11)]);
    await action(page, 'mutateProjectClientLocationQuickView', [id(1), { kind: 'delete', locationId: location.location_id }, id(11)]);
    expect((await records('client_locations').where({ location_id: location.location_id }).first())?.is_active).not.toBe(true);
    await login(page, 102);
    expect(await action(page, 'getProjectClientQuickView', [id(2), id(12)])).toContain('Permission denied');
  });
});
