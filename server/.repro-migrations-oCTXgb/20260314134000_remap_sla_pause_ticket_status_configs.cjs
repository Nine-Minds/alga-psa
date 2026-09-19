async function buildLegacyToBoardOwnedPauseConfigs(knex) {
  const legacyConfigs = await knex('status_sla_pause_config as cfg')
    .join('statuses as legacy', function joinLegacyStatus() {
      this.on('cfg.tenant', '=', 'legacy.tenant').andOn('cfg.status_id', '=', 'legacy.status_id');
    })
    .where('legacy.status_type', 'ticket')
    .whereNull('legacy.board_id')
    .select(
      'cfg.tenant',
      'cfg.status_id as legacy_status_id',
      'cfg.pauses_sla',
      'cfg.created_at',
      'legacy.name as legacy_status_name'
    );

  const clonedStatuses = await knex('statuses')
    .where({ status_type: 'ticket' })
    .whereNotNull('board_id')
    .select('tenant', 'status_id', 'name');

  const clonedStatusesByLegacyName = new Map();
  for (const status of clonedStatuses) {
    const key = `${status.tenant}:${status.name}`;
    const entries = clonedStatusesByLegacyName.get(key) || [];
    entries.push(status);
    clonedStatusesByLegacyName.set(key, entries);
  }

  const remappedConfigs = [];
  for (const config of legacyConfigs) {
    const clonedMatches = clonedStatusesByLegacyName.get(`${config.tenant}:${config.legacy_status_name}`) || [];

    for (const clonedStatus of clonedMatches) {
      remappedConfigs.push({
        tenant: config.tenant,
        status_id: clonedStatus.status_id,
        pauses_sla: config.pauses_sla,
        created_at: config.created_at
      });
    }
  }

  return remappedConfigs;
}

async function buildBoardOwnedToLegacyPauseConfigs(knex) {
  const boardOwnedConfigs = await knex('status_sla_pause_config as cfg')
    .join('statuses as cloned', function joinClonedStatus() {
      this.on('cfg.tenant', '=', 'cloned.tenant').andOn('cfg.status_id', '=', 'cloned.status_id');
    })
    .join('statuses as legacy', function joinLegacyStatus() {
      this.on('legacy.tenant', '=', 'cloned.tenant')
        .andOn('legacy.name', '=', 'cloned.name')
        .andOnVal('legacy.status_type', '=', 'ticket');
    })
    .where('cloned.status_type', 'ticket')
    .whereNotNull('cloned.board_id')
    .whereNull('legacy.board_id')
    .select(
      'cfg.tenant',
      'cfg.pauses_sla',
      'cfg.created_at',
      'legacy.status_id as legacy_status_id'
    );

  const dedupedConfigs = new Map();
  for (const config of boardOwnedConfigs) {
    dedupedConfigs.set(`${config.tenant}:${config.legacy_status_id}`, {
      tenant: config.tenant,
      status_id: config.legacy_status_id,
      pauses_sla: config.pauses_sla,
      created_at: config.created_at
    });
  }

  return Array.from(dedupedConfigs.values());
}

async function deleteLegacyTicketStatusConfigs(knex) {
  await knex.raw(`
    DELETE FROM status_sla_pause_config AS cfg
    USING statuses AS status
    WHERE cfg.tenant = status.tenant
      AND cfg.status_id = status.status_id
      AND status.status_type = 'ticket'
      AND status.board_id IS NULL
  `);
}

async function deleteBoardOwnedTicketStatusConfigs(knex) {
  await knex.raw(`
    DELETE FROM status_sla_pause_config AS cfg
    USING statuses AS status
    WHERE cfg.tenant = status.tenant
      AND cfg.status_id = status.status_id
      AND status.status_type = 'ticket'
      AND status.board_id IS NOT NULL
  `);
}

exports.up = async function up(knex) {
  const remappedConfigs = await buildLegacyToBoardOwnedPauseConfigs(knex);

  if (remappedConfigs.length > 0) {
    await knex('status_sla_pause_config')
      .insert(remappedConfigs)
      .onConflict(['tenant', 'status_id'])
      .ignore();
  }

  await deleteLegacyTicketStatusConfigs(knex);
};

exports.down = async function down(knex) {
  const restoredConfigs = await buildBoardOwnedToLegacyPauseConfigs(knex);

  if (restoredConfigs.length > 0) {
    await knex('status_sla_pause_config')
      .insert(restoredConfigs)
      .onConflict(['tenant', 'status_id'])
      .ignore();
  }

  await deleteBoardOwnedTicketStatusConfigs(knex);
};
