function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectLegacyTicketStatusReferences(value, legacyStatusIds, results, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLegacyTicketStatusReferences(item, legacyStatusIds, results, {
        ...context,
        inputPath: `${context.inputPath}[${index}]`
      });
    });
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  if (typeof value.status_id === 'string' && legacyStatusIds.has(value.status_id)) {
    if (typeof value.board_id !== 'string') {
      results.push({
        workflowId: context.workflowId,
        tableName: context.tableName,
        stepPath: context.stepPath,
        actionId: context.actionId,
        inputPath: `${context.inputPath}.status_id`,
        legacyStatusId: value.status_id
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    collectLegacyTicketStatusReferences(child, legacyStatusIds, results, {
      ...context,
      inputPath: `${context.inputPath}.${key}`
    });
  }
}

function collectWorkflowStepReferences(step, legacyStatusIds, results, context) {
  if (!isPlainObject(step)) {
    return;
  }

  if (isPlainObject(step.config) && isPlainObject(step.config.inputMapping)) {
    collectLegacyTicketStatusReferences(step.config.inputMapping, legacyStatusIds, results, {
      ...context,
      actionId: typeof step.config.actionId === 'string' ? step.config.actionId : null,
      inputPath: 'inputMapping'
    });
  }

  if (Array.isArray(step.then)) {
    step.then.forEach((child, index) => {
      collectWorkflowStepReferences(child, legacyStatusIds, results, {
        ...context,
        stepPath: `${context.stepPath}.then[${index}]`
      });
    });
  }

  if (Array.isArray(step.else)) {
    step.else.forEach((child, index) => {
      collectWorkflowStepReferences(child, legacyStatusIds, results, {
        ...context,
        stepPath: `${context.stepPath}.else[${index}]`
      });
    });
  }

  if (Array.isArray(step.body)) {
    step.body.forEach((child, index) => {
      collectWorkflowStepReferences(child, legacyStatusIds, results, {
        ...context,
        stepPath: `${context.stepPath}.body[${index}]`
      });
    });
  }

  if (Array.isArray(step.try)) {
    step.try.forEach((child, index) => {
      collectWorkflowStepReferences(child, legacyStatusIds, results, {
        ...context,
        stepPath: `${context.stepPath}.try[${index}]`
      });
    });
  }

  if (Array.isArray(step.catch)) {
    step.catch.forEach((child, index) => {
      collectWorkflowStepReferences(child, legacyStatusIds, results, {
        ...context,
        stepPath: `${context.stepPath}.catch[${index}]`
      });
    });
  }
}

async function findUnresolvedWorkflowTicketStatusReferences(knex) {
  const legacyStatusRows = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNull('board_id')
    .select('status_id');
  const legacyStatusIds = new Set(legacyStatusRows.map((row) => row.status_id));

  if (legacyStatusIds.size === 0) {
    return [];
  }

  const results = [];
  const tables = [
    { tableName: 'workflow_definitions', jsonColumn: 'draft_definition' },
    { tableName: 'workflow_definition_versions', jsonColumn: 'definition_json' }
  ];

  for (const { tableName, jsonColumn } of tables) {
    const records = await knex(tableName).select('workflow_id', jsonColumn);
    for (const record of records) {
      const definition = record[jsonColumn];
      if (!isPlainObject(definition) || !Array.isArray(definition.steps)) {
        continue;
      }

      definition.steps.forEach((step, index) => {
        collectWorkflowStepReferences(step, legacyStatusIds, results, {
          workflowId: record.workflow_id,
          tableName,
          stepPath: `steps[${index}]`,
          actionId: null,
          inputPath: 'inputMapping'
        });
      });
    }
  }

  return results;
}

exports.up = async function up(knex) {
  const unresolved = await findUnresolvedWorkflowTicketStatusReferences(knex);

  if (unresolved.length === 0) {
    return;
  }

  const detailLines = unresolved.map((entry) =>
    [
      `${entry.tableName}:${entry.workflowId}`,
      `step=${entry.stepPath}`,
      `action=${entry.actionId ?? 'unknown'}`,
      `path=${entry.inputPath}`,
      `legacy_status_id=${entry.legacyStatusId}`
    ].join(' ')
  );

  throw new Error(
    [
      'Unresolved legacy ticket status references remain in workflow definitions without literal board context.',
      'Update these workflow steps to use board-owned status ids or add explicit board context before rerunning the migration.',
      ...detailLines
    ].join('\n')
  );
};

exports.down = async function down() {
  // Guard migration only; nothing to roll back.
};
