/**
 * North-star E2E: drive the workflow-authoring agent loop over real HTTP
 * against the dev stack on :3232, exactly as the MCP connector would.
 * discover -> resolve tenant ids -> compose -> validate -> simulate -> save
 * -> concurrency-safe update (+ 409), with auth negative checks.
 */
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const REPO = process.env.ALGA_REPO_ROOT ?? process.cwd();
const BASE = process.env.ALGA_BASE_URL ?? 'http://localhost:3232';
const require = createRequire(`${REPO}/server/package.json`);
const { Client } = require('pg');

const env = Object.fromEntries(
  require('fs')
    .readFileSync(`${REPO}/server/.env.local`, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

// ---- DB fixtures ------------------------------------------------------
const db = new Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  database: env.DB_NAME_SERVER,
  user: env.DB_USER_ADMIN,
  password: env.DB_PASSWORD_ADMIN,
});
await db.connect();

const tenantRow = await db.query('select tenant from tenants limit 1');
const tenant = tenantRow.rows[0].tenant;
// glinda holds workflow:manage in the seeded dev tenant.
const userRow = await db.query(
  "select user_id, email, username from users where tenant=$1 and user_type='internal' and username='glinda' limit 1",
  [tenant]
);
const actor = userRow.rows[0];

// Provision a throwaway API key for the MCP-connector leg (sha256-at-rest).
const { createHash } = await import('crypto');
const plaintextApiKey = `e2e-${randomUUID()}`;
const apiKeyId = randomUUID();
await db.query(
  'insert into api_keys (api_key_id, api_key, user_id, tenant, description, active) values ($1,$2,$3,$4,$5,true)',
  [apiKeyId, createHash('sha256').update(plaintextApiKey).digest('hex'), actor.user_id, tenant, 'e2e north-star (auto-removed)']
);

const priorityRow = await db.query(
  "select priority_id, priority_name from priorities where tenant=$1 order by order_number desc limit 1",
  [tenant]
);
const priority = priorityRow.rows[0];

let groupRow = await db.query(
  "select group_id from user_activity_groups where tenant=$1 and user_id=$2 and lower(group_name)='important' limit 1",
  [tenant, actor.user_id]
);
if (groupRow.rows.length === 0) {
  const groupId = randomUUID();
  await db.query(
    'insert into user_activity_groups (tenant, group_id, user_id, group_name, sort_order, is_collapsed) values ($1,$2,$3,$4,0,false)',
    [tenant, groupId, actor.user_id, 'important']
  );
  groupRow = { rows: [{ group_id: groupId }] };
}
const importantGroupId = groupRow.rows[0].group_id;
console.log(`fixtures: tenant=${tenant} actor=${actor.username} priority=${priority.priority_name} group=${importantGroupId}`);

// ---- Session cookie ----------------------------------------------------
const { encode } = await import(`${REPO}/node_modules/@auth/core/jwt.js`);
const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
// Dev cookie names carry the app port (see packages/auth/src/lib/session.ts);
// Auth.js uses the cookie name as the JWE salt.
const port = new URL(env.NEXTAUTH_URL || BASE).port || '3232';
const cookieName = `authjs.session-token.${port}`;
const sessionToken = await encode({
  token: {
    id: actor.user_id,
    sub: actor.user_id,
    email: actor.email,
    name: actor.username,
    tenant,
    user_type: 'internal',
  },
  secret,
  salt: cookieName,
  maxAge: 60 * 60,
});
const authHeaders = { cookie: `${cookieName}=${sessionToken}`, 'content-type': 'application/json' };

const api = async (method, path, body, headers = authHeaders) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
};

// ---- 0. Auth negative --------------------------------------------------
{
  const res = await api('GET', '/api/workflow/registry/authoring-guide', undefined, { 'content-type': 'application/json' });
  check('unauthenticated request is rejected', res.status === 401 || res.status === 403, `status=${res.status}`);
}

// ---- 1. Discover -------------------------------------------------------
const guide = await api('GET', '/api/workflow/registry/authoring-guide');
check(
  'authoring guide serves definition schema + functions + worked example',
  guide.status === 200 &&
    !!guide.json?.definitionSchema &&
    Array.isArray(guide.json?.expressionLanguage?.functions) &&
    guide.json.expressionLanguage.functions.some((f) => f.name === 'append') &&
    !!guide.json?.workedExample?.definition,
  `status=${guide.status}`
);

const events = await api('GET', '/api/workflow/registry/events?search=ticket');
const ticketCreated = events.json?.events?.find((e) => e.event_type === 'TICKET_CREATED');
check(
  'event catalog lists TICKET_CREATED with a known payload schema ref',
  events.status === 200 && !!ticketCreated && ticketCreated.payload_schema_ref_status !== 'unknown',
  `status=${events.status} ref=${ticketCreated?.payload_schema_ref ?? 'none'} (${ticketCreated?.payload_schema_ref_status})`
);

const schemaRef = ticketCreated?.payload_schema_ref ?? 'payload.TicketCreated.v1';
const schema = await api('GET', `/api/workflow/registry/schemas/${encodeURIComponent(schemaRef)}`);
check('event payload schema resolves', schema.status === 200 && !!schema.json?.schema, `status=${schema.status}`);

const actions = await api('GET', '/api/workflow/registry/actions');
const actionList = Array.isArray(actions.json) ? actions.json : [];
const actionIds = new Set(actionList.map((a) => a.id));
check(
  'action registry exposes the loop actions incl. activities.*',
  actions.status === 200 &&
    ['tickets.find', 'contacts.find', 'tickets.update_fields', 'activities.find_group', 'activities.add_to_group'].every((id) => actionIds.has(id)),
  `status=${actions.status} count=${actionIds.size}`
);

// ---- 2. Compose the north-star definition ------------------------------
const definition = {
  id: 'e2e-vip-ticket-fast-lane',
  version: 1,
  name: 'E2E VIP ticket fast lane',
  description: 'E2E: tickets from bob@customer.com get high priority and land in the important activity group',
  payloadSchemaRef: schemaRef,
  trigger: { type: 'event', eventName: 'TICKET_CREATED' },
  steps: [
    {
      id: 'load-ticket',
      type: 'action.call',
      config: {
        actionId: 'tickets.find',
        version: 1,
        inputMapping: { ticket_id: { $expr: 'payload.ticketId' } },
        saveAs: 'vars.found',
      },
    },
    {
      id: 'has-contact',
      type: 'control.if',
      condition: { $expr: 'vars.found.ticket != null and vars.found.ticket.contact_name_id != null' },
      then: [
        {
          id: 'load-contact',
          type: 'action.call',
          config: {
            actionId: 'contacts.find',
            version: 1,
            inputMapping: { contact_id: { $expr: 'vars.found.ticket.contact_name_id' } },
            saveAs: 'vars.contactResult',
          },
        },
        {
          id: 'vip-check',
          type: 'control.if',
          condition: { $expr: 'vars.contactResult.contact != null and vars.contactResult.contact.email = "bob@customer.com"' },
          then: [
            {
              id: 'raise-priority',
              type: 'action.call',
              config: {
                actionId: 'tickets.update_fields',
                version: 1,
                inputMapping: {
                  ticket_id: { $expr: 'payload.ticketId' },
                  patch: { priority_id: priority.priority_id },
                },
              },
            },
            {
              id: 'find-important-group',
              type: 'action.call',
              config: {
                actionId: 'activities.find_group',
                version: 1,
                inputMapping: { groupName: 'important', ownerUserId: actor.user_id },
                saveAs: 'vars.importantGroup',
              },
            },
            {
              id: 'add-to-group',
              type: 'action.call',
              config: {
                actionId: 'activities.add_to_group',
                version: 1,
                inputMapping: {
                  groupId: { $expr: 'vars.importantGroup.groupId' },
                  activityId: { $expr: 'payload.ticketId' },
                  activityType: 'ticket',
                  ownerUserId: actor.user_id,
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

// ---- 3. Validate (negative then positive) ------------------------------
{
  const bad = JSON.parse(JSON.stringify(definition));
  bad.steps[0].config.actionId = 'ticket.find';
  const res = await api('POST', '/api/workflow-definitions/validate', { definition: bad });
  const unknown = res.json?.errors?.find((e) => e.code === 'UNKNOWN_ACTION');
  check(
    'validate flags a typoed actionId with a did-you-mean suggestion',
    res.status === 200 && !!unknown && String(unknown.suggestion ?? '').includes('tickets.find'),
    `suggestion=${unknown?.suggestion ?? 'none'}`
  );
}
{
  const res = await api('POST', '/api/workflow-definitions/validate', { definition });
  check(
    'the composed north-star definition validates clean',
    res.status === 200 && Array.isArray(res.json?.errors) && res.json.errors.length === 0,
    res.json?.errors?.length ? JSON.stringify(res.json.errors.slice(0, 2)) : 'no errors'
  );
}

// ---- 4. Simulate -------------------------------------------------------
const ticketId = randomUUID();
const contactId = randomUUID();
const sim = await api('POST', '/api/workflow-definitions/simulate', {
  definition,
  payload: { tenantId: tenant, occurredAt: new Date().toISOString(), ticketId, updatedFields: [], changes: {} },
  fixtures: {
    'load-ticket': { ticket: { ticket_id: ticketId, contact_name_id: contactId } },
    'load-contact': { contact: { contact_name_id: contactId, email: 'bob@customer.com' } },
    'find-important-group': { groupId: importantGroupId, groupName: 'important', sortOrder: 0, isCollapsed: false, itemCount: 0 },
  },
});
{
  const invocations = sim.json?.invocations ?? [];
  const priorityCall = invocations.find((i) => i.actionId === 'tickets.update_fields');
  const groupCall = invocations.find((i) => i.actionId === 'activities.add_to_group');
  check(
    'simulation completes and takes the VIP branch',
    sim.status === 200 && sim.json?.status === 'completed' &&
      sim.json?.trace?.find((t) => t.stepId === 'vip-check')?.branchTaken === 'then',
    `status=${sim.json?.status} vip-branch=${sim.json?.trace?.find((t) => t.stepId === 'vip-check')?.branchTaken}`
  );
  check(
    'simulated tickets.update_fields carries the resolved priority id',
    priorityCall?.input?.patch?.priority_id === priority.priority_id && priorityCall?.input?.ticket_id === ticketId,
    JSON.stringify(priorityCall?.input ?? null)
  );
  check(
    'simulated activities.add_to_group targets the important group with the ticket',
    groupCall?.input?.groupId === importantGroupId && groupCall?.input?.activityId === ticketId && groupCall?.input?.activityType === 'ticket',
    JSON.stringify(groupCall?.input ?? null)
  );
  check(
    'simulation performed zero real side effects (all actions stubbed)',
    invocations.length >= 4 && invocations.every((i) => ['fixture', 'schema', 'empty'].includes(i.outputSource)),
    `invocations=${invocations.length}`
  );
}

// Simulation without payload synthesizes one from the trigger event schema.
{
  const res = await api('POST', '/api/workflow-definitions/simulate', { definition });
  check(
    'simulate synthesizes a payload when none is provided',
    res.status === 200 && ['synthesized-from-event', 'synthesized-from-schema'].includes(res.json?.payloadSource),
    `payloadSource=${res.json?.payloadSource} status=${res.json?.status}`
  );
}

// ---- 4b. The MCP connector path: API key instead of a session -----------
{
  const keyHeaders = { 'x-api-key': plaintextApiKey, 'content-type': 'application/json' };
  const guideByKey = await api('GET', '/api/workflow/registry/authoring-guide', undefined, keyHeaders);
  check(
    'API-key caller (MCP connector path) can read the authoring guide',
    guideByKey.status === 200 && !!guideByKey.json?.definitionSchema,
    `status=${guideByKey.status}`
  );
  const validateByKey = await api('POST', '/api/workflow-definitions/validate', { definition }, keyHeaders);
  check(
    'API-key caller can validate a draft',
    validateByKey.status === 200 && validateByKey.json?.errors?.length === 0,
    `status=${validateByKey.status} errors=${validateByKey.json?.errors?.length}`
  );
  const simulateByKey = await api(
    'POST',
    '/api/workflow-definitions/simulate',
    { definition, payload: { tenantId: tenant, occurredAt: new Date().toISOString(), ticketId, updatedFields: [], changes: {} } },
    keyHeaders
  );
  check(
    'API-key caller can simulate a draft',
    simulateByKey.status === 200 && ['completed', 'paused-at-wait'].includes(simulateByKey.json?.status),
    `status=${simulateByKey.status} simStatus=${simulateByKey.json?.status}`
  );
}

// ---- 5. Save the draft --------------------------------------------------
const created = await api('POST', '/api/workflow-definitions', { definition });
const workflowId = created.json?.workflowId;
check(
  'draft created with workflowId + draftVersion',
  created.status === 200 || created.status === 201 ? !!workflowId && created.json?.draftVersion === 1 : false,
  `status=${created.status} id=${workflowId} draftVersion=${created.json?.draftVersion}`
);

// ---- 6. Update loop: GET -> PUT (fresh) -> PUT (stale => 409) -----------
{
  const fetched = await api('GET', `/api/workflow-definitions/${workflowId}/1`);
  const draftDoc = fetched.json?.definition_json ?? fetched.json?.draft_definition ?? definition;
  check('draft round-trips via GET', fetched.status === 200, `status=${fetched.status}`);

  const updatedDoc = { ...JSON.parse(JSON.stringify(draftDoc)), id: workflowId, description: 'E2E: updated description (also add a comment later)' };
  const put1 = await api('PUT', `/api/workflow-definitions/${workflowId}/1`, {
    definition: updatedDoc,
    expectedDraftVersion: 1,
  });
  check('PUT with matching expectedDraftVersion succeeds', put1.status === 200, `status=${put1.status}`);

  const put2 = await api('PUT', `/api/workflow-definitions/${workflowId}/1`, {
    definition: updatedDoc,
    expectedDraftVersion: 99,
  });
  check('PUT with stale expectedDraftVersion returns 409', put2.status === 409, `status=${put2.status}`);
}

// ---- Cleanup ------------------------------------------------------------
if (workflowId) {
  await db.query('delete from workflow_definitions where tenant=$1 and workflow_id=$2', [tenant, workflowId]);
  console.log(`cleanup: removed draft ${workflowId}`);
}
await db.query('delete from api_keys where tenant=$1 and api_key_id=$2', [tenant, apiKeyId]);
await db.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
