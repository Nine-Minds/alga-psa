#!/usr/bin/env node
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const [mode] = process.argv.slice(2);
if (!['setup', 'cleanup'].includes(mode)) throw new Error('Usage: node scripts/security-dos-schedule-review-fixture.mjs setup|cleanup');

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running the review fixture.`);
  return value;
};
const databaseUrl = required('DATABASE_URL');
const tenant = required('SCHEDULE_REVIEW_TENANT_ID');
const ownerUserId = required('SCHEDULE_REVIEW_OWNER_USER_ID');
const viewerUserId = required('SCHEDULE_REVIEW_VIEWER_USER_ID');
const baseUrl = required('SCHEDULE_REVIEW_BASE_URL').replace(/\/$/, '');
const dbUrl = new URL(databaseUrl);
if (!/(?:^|[_-])test(?:$|[_-])/i.test(dbUrl.pathname.slice(1))) {
  throw new Error('Refusing to seed a database whose name does not identify it as a test database.');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID.test(tenant) || !UUID.test(ownerUserId) || !UUID.test(viewerUserId) || ownerUserId === viewerUserId) {
  throw new Error('Tenant, distinct owner, and viewer IDs must be UUIDs.');
}

const namespace = 'security-dos-review-fixture-v1';
const idFor = (name) => {
  if (name === 'dispatch-activity') return 'ffffffff-ffff-5fff-bfff-ffffffffffff';
  const bytes = createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const entryIds = [
  idFor('ordinary'), idFor('recurring'), idFor('dispatch-activity'),
  idFor('outside-before'), idFor('outside-after'),
];
const ownedTitlePrefix = 'Review fixture:';

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  let workItem = { rowCount: 1, rows: [{ ticket_id: null }] };
  if (mode === 'setup') {
    const context = await client.query(
      `SELECT t.product_code, owner.user_type AS owner_type, viewer.user_type AS viewer_type
         FROM tenants t
         JOIN users owner ON owner.tenant = t.tenant AND owner.user_id = $2
         JOIN users viewer ON viewer.tenant = t.tenant AND viewer.user_id = $3
        WHERE t.tenant = $1`, [tenant, ownerUserId, viewerUserId]);
    if (context.rowCount !== 1 || context.rows[0].product_code !== 'psa' ||
      context.rows[0].owner_type !== 'internal' || context.rows[0].viewer_type !== 'internal') {
      throw new Error('PSA UI fixture needs distinct existing internal owner/viewer users in an isolated PSA tenant; product routing and user records are not modified.');
    }
    const permissions = await client.query(
      `SELECT DISTINCT ur.user_id, p.resource, p.action
         FROM user_roles ur
         JOIN role_permissions rp ON rp.tenant = ur.tenant AND rp.role_id = ur.role_id
         JOIN permissions p ON p.tenant = rp.tenant AND p.permission_id = rp.permission_id
        WHERE ur.tenant = $1 AND ur.user_id = ANY($2::uuid[])`, [tenant, [ownerUserId, viewerUserId]]);
    const byUser = new Map([[ownerUserId, new Set()], [viewerUserId, new Set()]]);
    for (const { user_id, resource, action } of permissions.rows) byUser.get(user_id)?.add(`${resource}:${action}`);
    const ownerPermissions = byUser.get(ownerUserId);
    const viewerPermissions = byUser.get(viewerUserId);
    const scheduleWrite = (set) => [...set].some(value => value.startsWith('user_schedule:') && value !== 'user_schedule:read');
    if (!ownerPermissions.has('user_schedule:read') || scheduleWrite(ownerPermissions) ||
      !ownerPermissions.has('technician_dispatch:read') || !ownerPermissions.has('ticket:read')) {
      throw new Error('Fixture owner needs user_schedule:read without schedule write permissions, plus technician_dispatch:read and ticket:read for dispatch/activity replay. No permissions were changed.');
    }
    if (!viewerPermissions.has('user_schedule:read') || scheduleWrite(viewerPermissions)) {
      throw new Error('Read-only viewer needs user_schedule:read and no user_schedule write actions. No permissions were changed.');
    }
    const readShare = await client.query(
      `SELECT c.calendar_id, cs.access_level
         FROM calendars c
         JOIN calendar_shares cs ON cs.tenant = c.tenant AND cs.calendar_id = c.calendar_id
        WHERE c.tenant = $1 AND c.calendar_type = 'personal' AND c.owner_user_id = $2
          AND cs.grantee_type = 'user' AND cs.grantee_id = $3 AND cs.access_level = 'read'
        LIMIT 1`, [tenant, ownerUserId, viewerUserId]);
    if (readShare.rowCount !== 1) {
      throw new Error('Read-only viewer needs an existing read-level share to the owner personal calendar. The fixture does not create or change shares.');
    }
    workItem = await client.query('SELECT ticket_id FROM tickets WHERE tenant = $1 AND assigned_to = $2 ORDER BY ticket_id LIMIT 1', [tenant, ownerUserId]);
    if (workItem.rowCount !== 1) throw new Error('The fixture owner needs an existing assigned ticket for dispatch/activity replay.');
  }

  const existing = await client.query(
    'SELECT entry_id, title FROM schedule_entries WHERE tenant = $1 AND entry_id = ANY($2::uuid[]) FOR UPDATE', [tenant, entryIds]);
  if (existing.rows.some(({ title }) => !title.startsWith(ownedTitlePrefix))) {
    throw new Error('A deterministic fixture ID is already owned by another record; refusing to overwrite or clean it.');
  }
  await client.query(
    `DELETE FROM schedule_entry_assignees a USING schedule_entries e
      WHERE a.tenant = $1 AND a.entry_id = ANY($2::uuid[]) AND e.tenant = a.tenant AND e.entry_id = a.entry_id AND e.title LIKE $3`,
    [tenant, entryIds, `${ownedTitlePrefix}%`]);
  await client.query(
    `DELETE FROM schedule_entries WHERE tenant = $1 AND entry_id = ANY($2::uuid[]) AND title LIKE $3`,
    [tenant, entryIds, `${ownedTitlePrefix}%`]);

  if (mode === 'setup') {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const day = (offset) => new Date(tomorrow.getTime() + offset * 86_400_000);
    const entries = [
      { name: 'ordinary', title: 'Ordinary appointment', start: day(0), recurring: false, pattern: null },
      { name: 'recurring', title: 'Daily recurring appointment', start: day(1), recurring: true, pattern: { frequency: 'daily', interval: 1, startDate: day(1).toISOString(), count: 10 } },
      { name: 'dispatch-activity', title: 'Dispatch and activity appointment', start: day(0), recurring: false, pattern: null, workItemId: workItem.rows[0].ticket_id, workItemType: 'ticket' },
      { name: 'outside-before', title: 'Out of window before', start: new Date(day(0).getTime() - 40 * 86_400_000), recurring: false, pattern: null },
      { name: 'outside-after', title: 'Out of window after', start: new Date(day(0).getTime() + 40 * 86_400_000), recurring: false, pattern: null },
    ];
    for (const entry of entries) {
      const entryId = idFor(entry.name);
      const end = new Date(entry.start.getTime() + 60 * 60 * 1000);
      await client.query(
        `INSERT INTO schedule_entries
          (tenant, entry_id, title, work_item_id, scheduled_start, scheduled_end, status, notes, recurrence_pattern,
           work_item_type, created_at, updated_at, is_private, is_all_day, is_recurring)
         VALUES ($1,$2,$3,$4,$5,$6,'scheduled','', $7::jsonb, $8, NOW(), NOW(), false, false, $9)`,
        [tenant, entryId, `${ownedTitlePrefix} ${entry.title}`, entry.workItemId ?? null, entry.start, end,
          entry.pattern === null ? null : JSON.stringify(entry.pattern), entry.workItemType ?? 'ad_hoc', entry.recurring]);
      await client.query(
        `INSERT INTO schedule_entry_assignees (tenant, entry_id, user_id) VALUES ($1,$2,$3)`, [tenant, entryId, ownerUserId]);
    }

    const ordinaryId = idFor('ordinary');
    const recurringId = idFor('recurring');
    const occurrence = new Date(day(1).getTime() + 86_400_000);
    const query = (values) => new URLSearchParams(values).toString();
    const link = (entryId, occurrenceStart, date) => `${baseUrl}/msp/schedule?${query({
      entryId,
      ...(occurrenceStart ? { occurrenceStart: occurrenceStart.toISOString() } : {}),
      scheduleDate: date.toISOString().slice(0, 10),
      scheduleView: 'day',
    })}`;
    await client.query('COMMIT');
    console.log(JSON.stringify({
      mode,
      fixture: namespace,
      tenant,
      minimumPermissionOwner: ownerUserId,
      readOnlyViewer: viewerUserId,
      ordinaryLink: link(ordinaryId, null, day(0)),
      recurringOccurrenceLink: link(recurringId, occurrence, occurrence),
      outsideWindowEntries: 2,
      dispatchActivityEntryId: idFor('dispatch-activity'),
      cleanup: 'node scripts/security-dos-schedule-review-fixture.mjs cleanup',
    }, null, 2));
  } else {
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode, fixture: namespace, tenant, removedOwnedEntryCount: existing.rowCount }, null, 2));
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
