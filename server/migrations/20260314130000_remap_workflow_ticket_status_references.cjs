function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function visitWorkflowSteps(steps, visitor) {
  if (!Array.isArray(steps)) {
    return steps;
  }

  return steps.map((step) => {
    if (!isPlainObject(step)) {
      return step;
    }

    let nextStep = visitor(step);

    if (!isPlainObject(nextStep)) {
      return nextStep;
    }

    if (Array.isArray(nextStep.then)) {
      nextStep = { ...nextStep, then: visitWorkflowSteps(nextStep.then, visitor) };
    }

    if (Array.isArray(nextStep.else)) {
      nextStep = { ...nextStep, else: visitWorkflowSteps(nextStep.else, visitor) };
    }

    if (Array.isArray(nextStep.body)) {
      nextStep = { ...nextStep, body: visitWorkflowSteps(nextStep.body, visitor) };
    }

    if (Array.isArray(nextStep.try)) {
      nextStep = { ...nextStep, try: visitWorkflowSteps(nextStep.try, visitor) };
    }

    if (Array.isArray(nextStep.catch)) {
      nextStep = { ...nextStep, catch: visitWorkflowSteps(nextStep.catch, visitor) };
    }

    return nextStep;
  });
}

function remapBoardScopedStatusReferences(value, statusMap) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const remapped = remapBoardScopedStatusReferences(item, statusMap);
      if (remapped !== item) {
        changed = true;
      }
      return remapped;
    });
    return changed ? next : value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  let changed = false;
  const next = {};

  for (const [key, child] of Object.entries(value)) {
    const remappedChild = remapBoardScopedStatusReferences(child, statusMap);
    if (remappedChild !== child) {
      changed = true;
    }
    next[key] = remappedChild;
  }

  if (typeof next.board_id === 'string' && typeof next.status_id === 'string') {
    const remappedStatusId = statusMap.get(`${next.board_id}:${next.status_id}`);
    if (remappedStatusId && remappedStatusId !== next.status_id) {
      next.status_id = remappedStatusId;
      changed = true;
    }
  }

  return changed ? next : value;
}

function remapWorkflowDefinition(definition, statusMap) {
  if (!isPlainObject(definition) || !Array.isArray(definition.steps)) {
    return definition;
  }

  let changed = false;
  const nextSteps = visitWorkflowSteps(definition.steps, (step) => {
    if (!isPlainObject(step.config) || !isPlainObject(step.config.inputMapping)) {
      return step;
    }

    const remappedInputMapping = remapBoardScopedStatusReferences(step.config.inputMapping, statusMap);
    if (remappedInputMapping === step.config.inputMapping) {
      return step;
    }

    changed = true;
    return {
      ...step,
      config: {
        ...step.config,
        inputMapping: remappedInputMapping
      }
    };
  });

  return changed ? { ...definition, steps: nextSteps } : definition;
}

async function buildLegacyToBoardOwnedStatusMap(knex) {
  const legacyStatuses = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNull('board_id')
    .select('tenant', 'status_id', 'name');

  const clonedStatuses = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNotNull('board_id')
    .select('tenant', 'board_id', 'status_id', 'name');

  const legacyByTenantAndName = new Map();
  for (const status of legacyStatuses) {
    legacyByTenantAndName.set(`${status.tenant}:${status.name}`, status.status_id);
  }

  const remap = new Map();
  for (const status of clonedStatuses) {
    const legacyStatusId = legacyByTenantAndName.get(`${status.tenant}:${status.name}`);
    if (!legacyStatusId) {
      continue;
    }
    remap.set(`${status.board_id}:${legacyStatusId}`, status.status_id);
  }

  return remap;
}

async function buildBoardOwnedToLegacyStatusMap(knex) {
  const legacyStatuses = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNull('board_id')
    .select('tenant', 'status_id', 'name');

  const clonedStatuses = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNotNull('board_id')
    .select('tenant', 'board_id', 'status_id', 'name');

  const legacyByTenantAndName = new Map();
  for (const status of legacyStatuses) {
    legacyByTenantAndName.set(`${status.tenant}:${status.name}`, status.status_id);
  }

  const remap = new Map();
  for (const status of clonedStatuses) {
    const legacyStatusId = legacyByTenantAndName.get(`${status.tenant}:${status.name}`);
    if (!legacyStatusId) {
      continue;
    }
    remap.set(`${status.board_id}:${status.status_id}`, legacyStatusId);
  }

  return remap;
}

async function remapWorkflowTable(knex, tableName, jsonColumn, statusMap) {
  const records = await knex(tableName).select('workflow_id', jsonColumn);
  let updatedCount = 0;

  for (const record of records) {
    const definition = record[jsonColumn];
    const remappedDefinition = remapWorkflowDefinition(definition, statusMap);
    if (remappedDefinition === definition) {
      continue;
    }

    await knex(tableName)
      .where({ workflow_id: record.workflow_id })
      .update({
        [jsonColumn]: remappedDefinition,
        updated_at: new Date().toISOString()
      });

    updatedCount += 1;
  }

  return updatedCount;
}

exports.up = async function up(knex) {
  const statusMap = await buildLegacyToBoardOwnedStatusMap(knex);

  if (statusMap.size === 0) {
    console.log('[workflow-ticket-status-remap] No board-owned ticket status remaps found; skipping.');
    return;
  }

  const draftUpdates = await remapWorkflowTable(knex, 'workflow_definitions', 'draft_definition', statusMap);
  const versionUpdates = await remapWorkflowTable(knex, 'workflow_definition_versions', 'definition_json', statusMap);

  console.log(
    `[workflow-ticket-status-remap] Updated ${draftUpdates} workflow draft(s) and ${versionUpdates} published version(s).`
  );
};

exports.down = async function down(knex) {
  const statusMap = await buildBoardOwnedToLegacyStatusMap(knex);

  if (statusMap.size === 0) {
    return;
  }

  await remapWorkflowTable(knex, 'workflow_definition_versions', 'definition_json', statusMap);
  await remapWorkflowTable(knex, 'workflow_definitions', 'draft_definition', statusMap);
};
