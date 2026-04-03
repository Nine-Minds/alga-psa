function makeKey(...parts) {
  return parts.map((part) => String(part)).join('::');
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  return typeof value === 'object' ? value : {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function addUnique(nextValues, seenValues, value) {
  if (!seenValues.has(value)) {
    seenValues.add(value);
    nextValues.push(value);
  }
}

async function loadTicketStatusMaps(knex) {
  const [legacyRows, boardOwnedRows] = await Promise.all([
    knex('statuses')
      .where({ status_type: 'ticket' })
      .whereNull('board_id')
      .select('tenant', 'status_id', 'name'),
    knex('statuses')
      .where({ status_type: 'ticket' })
      .whereNotNull('board_id')
      .select('tenant', 'status_id', 'name', 'board_id'),
  ]);

  const legacyNameByStatusKey = new Map();
  const legacyStatusIdByNameKey = new Map();
  const boardOwnedStatusIdByBoardNameKey = new Map();
  const boardOwnedNameByStatusKey = new Map();
  const boardIdsByTenantStatusName = new Map();

  for (const row of legacyRows) {
    legacyNameByStatusKey.set(makeKey(row.tenant, row.status_id), row.name);
    legacyStatusIdByNameKey.set(makeKey(row.tenant, row.name), row.status_id);
  }

  for (const row of boardOwnedRows) {
    boardOwnedStatusIdByBoardNameKey.set(
      makeKey(row.tenant, row.board_id, row.name),
      row.status_id
    );
    boardOwnedNameByStatusKey.set(makeKey(row.tenant, row.status_id), row.name);

    const boardIdsKey = makeKey(row.tenant, row.name);
    const boardIds = boardIdsByTenantStatusName.get(boardIdsKey) ?? [];
    boardIds.push(row.board_id);
    boardIdsByTenantStatusName.set(boardIdsKey, boardIds);
  }

  for (const [boardIdsKey, boardIds] of boardIdsByTenantStatusName.entries()) {
    boardIdsByTenantStatusName.set(boardIdsKey, [...new Set(boardIds)].sort());
  }

  return {
    legacyNameByStatusKey,
    legacyStatusIdByNameKey,
    boardOwnedStatusIdByBoardNameKey,
    boardOwnedNameByStatusKey,
    boardIdsByTenantStatusName,
  };
}

async function remapSurveyTriggerTicketStatuses(knex) {
  const statusMaps = await loadTicketStatusMaps(knex);
  const triggers = await knex('survey_triggers')
    .select('tenant', 'trigger_id', 'trigger_type', 'trigger_conditions')
    .orderBy('tenant', 'asc')
    .orderBy('trigger_id', 'asc');

  for (const trigger of triggers) {
    if (trigger.trigger_type !== 'ticket_closed') {
      continue;
    }

    const triggerConditions = parseJsonObject(trigger.trigger_conditions);
    const statusIds = normalizeStringArray(triggerConditions.status_id);
    if (statusIds.length === 0) {
      continue;
    }

    const configuredBoardIds = normalizeStringArray(triggerConditions.board_id);
    const nextStatusIds = [];
    const seenStatusIds = new Set();
    let changed = false;

    for (const statusId of statusIds) {
      const legacyStatusName = statusMaps.legacyNameByStatusKey.get(
        makeKey(trigger.tenant, statusId)
      );

      if (!legacyStatusName) {
        addUnique(nextStatusIds, seenStatusIds, statusId);
        continue;
      }

      const targetBoardIds =
        configuredBoardIds.length > 0
          ? [...new Set(configuredBoardIds)].sort()
          : statusMaps.boardIdsByTenantStatusName.get(
              makeKey(trigger.tenant, legacyStatusName)
            ) ?? [];

      if (targetBoardIds.length === 0) {
        throw new Error(
          `Unable to remap survey trigger ${trigger.trigger_id}: no board-owned ticket statuses found for legacy status ${statusId}`
        );
      }

      for (const boardId of targetBoardIds) {
        const boardOwnedStatusId = statusMaps.boardOwnedStatusIdByBoardNameKey.get(
          makeKey(trigger.tenant, boardId, legacyStatusName)
        );

        if (!boardOwnedStatusId) {
          throw new Error(
            `Unable to remap survey trigger ${trigger.trigger_id}: missing board-owned ticket status for board ${boardId} and legacy status ${statusId}`
          );
        }

        addUnique(nextStatusIds, seenStatusIds, boardOwnedStatusId);
      }

      changed = true;
    }

    if (changed) {
      await knex('survey_triggers')
        .where({ tenant: trigger.tenant, trigger_id: trigger.trigger_id })
        .update({
          trigger_conditions: {
            ...triggerConditions,
            status_id: nextStatusIds,
          },
          updated_at: knex.fn.now(),
        });
    }
  }
}

async function restoreLegacySurveyTriggerTicketStatuses(knex) {
  const statusMaps = await loadTicketStatusMaps(knex);
  const triggers = await knex('survey_triggers')
    .select('tenant', 'trigger_id', 'trigger_type', 'trigger_conditions')
    .orderBy('tenant', 'asc')
    .orderBy('trigger_id', 'asc');

  for (const trigger of triggers) {
    if (trigger.trigger_type !== 'ticket_closed') {
      continue;
    }

    const triggerConditions = parseJsonObject(trigger.trigger_conditions);
    const statusIds = normalizeStringArray(triggerConditions.status_id);
    if (statusIds.length === 0) {
      continue;
    }

    const nextStatusIds = [];
    const seenStatusIds = new Set();
    let changed = false;

    for (const statusId of statusIds) {
      const boardOwnedStatusName = statusMaps.boardOwnedNameByStatusKey.get(
        makeKey(trigger.tenant, statusId)
      );

      if (!boardOwnedStatusName) {
        addUnique(nextStatusIds, seenStatusIds, statusId);
        continue;
      }

      const legacyStatusId = statusMaps.legacyStatusIdByNameKey.get(
        makeKey(trigger.tenant, boardOwnedStatusName)
      );

      if (!legacyStatusId) {
        throw new Error(
          `Unable to restore survey trigger ${trigger.trigger_id}: missing legacy ticket status for board-owned status ${statusId}`
        );
      }

      addUnique(nextStatusIds, seenStatusIds, legacyStatusId);
      changed = true;
    }

    if (changed) {
      await knex('survey_triggers')
        .where({ tenant: trigger.tenant, trigger_id: trigger.trigger_id })
        .update({
          trigger_conditions: {
            ...triggerConditions,
            status_id: nextStatusIds,
          },
          updated_at: knex.fn.now(),
        });
    }
  }
}

exports.up = async function up(knex) {
  await remapSurveyTriggerTicketStatuses(knex);
};

exports.down = async function down(knex) {
  await restoreLegacySurveyTriggerTicketStatuses(knex);
};
