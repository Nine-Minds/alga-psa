/**
 * Stamp an explicit `notify` choice on existing `tickets.create` workflow steps.
 *
 * `tickets.create` now publishes TICKET_CREATED, so assignees would be notified twice by workflows
 * that already send their own notification. Existing steps get:
 *  - { internal: false, contact: false } when the workflow contains notifications.send_in_app / email.send
 *  - { internal: true,  contact: false } otherwise
 *
 * Literal shape: resolveMappingValue treats any object without $expr/$secret as a literal and resolves
 * its members recursively, so a plain nested object of booleans is a valid inputMapping value.
 */
const SELF_NOTIFY_ACTIONS = new Set(['notifications.send_in_app', 'email.send']);
const CHILD_KEYS = ['then', 'else', 'body', 'try', 'catch'];

const STAMP_SILENT = Object.freeze({ internal: false, contact: false });
const STAMP_DEFAULT = Object.freeze({ internal: true, contact: false });

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapSteps(steps, fn) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((step) => {
    if (!isPlainObject(step)) return step;
    let next = fn(step);
    if (!isPlainObject(next)) return next;
    for (const key of CHILD_KEYS) {
      if (Array.isArray(next[key])) {
        next = { ...next, [key]: mapSteps(next[key], fn) };
      }
    }
    return next;
  });
}

function definitionSendsOwnNotifications(steps) {
  let found = false;
  mapSteps(steps, (step) => {
    if (isPlainObject(step.config) && SELF_NOTIFY_ACTIONS.has(step.config.actionId)) found = true;
    return step;
  });
  return found;
}

function sameStamp(value, stamp) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    value.internal === stamp.internal &&
    value.contact === stamp.contact
  );
}

/** Pure visitor: returns the same reference when nothing changes. */
function stampDefinition(definition) {
  if (!isPlainObject(definition) || !Array.isArray(definition.steps)) return definition;
  const stamp = definitionSendsOwnNotifications(definition.steps) ? STAMP_SILENT : STAMP_DEFAULT;
  let changed = false;
  const steps = mapSteps(definition.steps, (step) => {
    const config = step.config;
    if (!isPlainObject(config) || config.actionId !== 'tickets.create' || !isPlainObject(config.inputMapping)) {
      return step;
    }
    if ('notify' in config.inputMapping) return step;
    changed = true;
    return { ...step, config: { ...config, inputMapping: { ...config.inputMapping, notify: { ...stamp } } } };
  });
  return changed ? { ...definition, steps } : definition;
}

/** Pure visitor for `down`: removes only the two stamped literals. */
function unstampDefinition(definition) {
  if (!isPlainObject(definition) || !Array.isArray(definition.steps)) return definition;
  let changed = false;
  const steps = mapSteps(definition.steps, (step) => {
    const config = step.config;
    if (!isPlainObject(config) || config.actionId !== 'tickets.create' || !isPlainObject(config.inputMapping)) {
      return step;
    }
    const notify = config.inputMapping.notify;
    if (!sameStamp(notify, STAMP_SILENT) && !sameStamp(notify, STAMP_DEFAULT)) return step;
    changed = true;
    const { notify: _removed, ...inputMapping } = config.inputMapping;
    return { ...step, config: { ...config, inputMapping } };
  });
  return changed ? { ...definition, steps } : definition;
}

async function rewriteTable(knex, table, keyColumn, column, visitor) {
  // Versions are keyed by version_id: workflow_id is shared by every version of a workflow.
  const records = await knex(table).select(keyColumn, column);
  let updated = 0;
  for (const record of records) {
    const before = record[column];
    const after = visitor(before);
    if (after === before) continue;
    await knex(table).where({ [keyColumn]: record[keyColumn] }).update({ [column]: JSON.stringify(after) });
    updated += 1;
  }
  return updated;
}

exports.up = async function up(knex) {
  const drafts = await rewriteTable(knex, 'workflow_definitions', 'workflow_id', 'draft_definition', stampDefinition);
  const versions = await rewriteTable(knex, 'workflow_definition_versions', 'version_id', 'definition_json', stampDefinition);
  console.log(`[stamp-ticket-create-notify] Updated ${drafts} draft(s) and ${versions} version(s).`);
};

exports.down = async function down(knex) {
  await rewriteTable(knex, 'workflow_definition_versions', 'version_id', 'definition_json', unstampDefinition);
  await rewriteTable(knex, 'workflow_definitions', 'workflow_id', 'draft_definition', unstampDefinition);
};

exports.stampDefinition = stampDefinition;
exports.unstampDefinition = unstampDefinition;
