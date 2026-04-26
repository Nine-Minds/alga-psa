const { createHash, randomUUID } = require('crypto');

exports.config = { transaction: false };

const LEGACY_EMAIL_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';
const LEGACY_EMAIL_WORKFLOW_KEY = 'system.email-processing';

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const hasTable = async (knex, tableName) => knex.schema.hasTable(tableName);

const isCitusEnabled = async (knex) => {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);
  return Boolean(result.rows?.[0]?.enabled);
};

const isWorkflowDefinitionsDistributed = async (knex) => {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = 'workflow_definitions'::regclass
    ) AS distributed
  `);
  return Boolean(result.rows?.[0]?.distributed);
};

const getWorkflowDefinitionsPrimaryKey = async (knex) => {
  const result = await knex.raw(`
    SELECT
      c.conname AS constraint_name,
      array_agg(a.attname ORDER BY ord.ordinality) AS columns
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ord.attnum
    WHERE c.conrelid = 'workflow_definitions'::regclass
      AND c.contype = 'p'
    GROUP BY c.conname
  `);
  return result.rows?.[0] ?? null;
};

const ensureWorkflowDefinitionsCitusDistribution = async (knex) => {
  if (!(await isCitusEnabled(knex))) {
    return;
  }

  if (await isWorkflowDefinitionsDistributed(knex)) {
    return;
  }

  const primaryKey = await getWorkflowDefinitionsPrimaryKey(knex);
  const primaryKeyColumns = primaryKey?.columns ?? [];
  const hasTenantScopedPrimaryKey =
    primaryKeyColumns.length === 2 &&
    primaryKeyColumns.includes('tenant_id') &&
    primaryKeyColumns.includes('workflow_id');

  if (primaryKey && !hasTenantScopedPrimaryKey) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ?? CASCADE', [
      'workflow_definitions',
      primaryKey.constraint_name,
    ]);
  }

  if (!hasTenantScopedPrimaryKey) {
    await knex.raw(`
      ALTER TABLE workflow_definitions
      ADD CONSTRAINT workflow_definitions_tenant_workflow_pk
      PRIMARY KEY (tenant_id, workflow_id)
    `);
  }

  await knex.raw(`
    SELECT create_distributed_table('workflow_definitions', 'tenant_id', colocate_with => 'tenants')
  `);
};

const rewriteDefinitionId = (value, workflowId) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return { ...value, id: workflowId };
};

const uniqueStrings = (values) => Array.from(new Set(
  values
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
));

const deterministicWorkflowId = (workflowId, tenantId) => {
  const hex = createHash('sha256').update(`${workflowId}:${tenantId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const collectTenantEvidence = async (knex, workflow) => {
  const evidence = [];

  const runRows = await knex('workflow_runs')
    .distinct('tenant_id')
    .where({ workflow_id: workflow.workflow_id })
    .whereNotNull('tenant_id');
  evidence.push(...runRows.map((row) => row.tenant_id));

  if (await hasTable(knex, 'tenant_workflow_schedule')) {
    const scheduleRows = await knex('tenant_workflow_schedule')
      .distinct('tenant_id')
      .where({ workflow_id: workflow.workflow_id })
      .whereNotNull('tenant_id');
    evidence.push(...scheduleRows.map((row) => row.tenant_id));
  }

  const directEvidence = uniqueStrings(evidence);
  if (directEvidence.length > 0) {
    return directEvidence;
  }

  const actorIds = uniqueStrings([workflow.created_by, workflow.updated_by]);
  if (!actorIds.length) {
    return [];
  }

  const actorRows = await knex('users')
    .distinct('tenant')
    .whereIn('user_id', actorIds)
    .whereNotNull('tenant');
  return uniqueStrings(actorRows.map((row) => row.tenant));
};

const deleteObsoleteLegacyWorkflow = async (knex, workflow) => {
  await knex('workflow_definition_versions').where({ workflow_id: workflow.workflow_id }).del();

  if (await hasTable(knex, 'tenant_workflow_schedule')) {
    await knex('tenant_workflow_schedule').where({ workflow_id: workflow.workflow_id }).del();
  }

  await knex('workflow_definitions').where({ workflow_id: workflow.workflow_id }).del();
};

const cloneWorkflowForTenant = async (knex, workflow, tenantId, options = {}) => {
  const now = new Date().toISOString();
  const existingClone = workflow.key
    ? await knex('workflow_definitions')
      .where({ tenant_id: tenantId, key: workflow.key })
      .whereNot('workflow_id', workflow.workflow_id)
      .first()
    : null;
  const newWorkflowId = existingClone?.workflow_id ?? deterministicWorkflowId(workflow.workflow_id, tenantId);

  if (!existingClone) {
    const clonedWorkflow = {
      ...workflow,
      workflow_id: newWorkflowId,
      tenant_id: tenantId,
      is_system: false,
      is_visible: options.hide ? false : workflow.is_visible,
      is_paused: options.pause ? true : workflow.is_paused,
      draft_definition: rewriteDefinitionId(workflow.draft_definition, newWorkflowId),
      created_at: workflow.created_at ?? now,
      updated_at: now,
    };

    await knex('workflow_definitions')
      .insert(clonedWorkflow)
      .onConflict('workflow_id')
      .ignore();
  }

  const versionRows = await knex('workflow_definition_versions')
    .where({ workflow_id: workflow.workflow_id })
    .orderBy('version', 'asc');

  for (const version of versionRows) {
    await knex('workflow_definition_versions')
      .insert({
        ...version,
        version_id: randomUUID(),
        workflow_id: newWorkflowId,
        definition_json: rewriteDefinitionId(version.definition_json, newWorkflowId),
        created_at: version.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['workflow_id', 'version'])
      .ignore();
  }

  await knex('workflow_runs')
    .where({ workflow_id: workflow.workflow_id, tenant_id: tenantId })
    .update({ workflow_id: newWorkflowId });

  if (await hasTable(knex, 'tenant_workflow_schedule')) {
    await knex('tenant_workflow_schedule')
      .where({ workflow_id: workflow.workflow_id, tenant_id: tenantId })
      .update({ workflow_id: newWorkflowId });
  }

  return newWorkflowId;
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const hasTenantId = await knex.schema.hasColumn('workflow_definitions', 'tenant_id');
  if (!hasTenantId) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.text('tenant_id');
    });
  }

  await knex.raw('ALTER TABLE workflow_definitions DROP CONSTRAINT IF EXISTS workflow_definitions_key_unique');
  await knex.raw('DROP INDEX IF EXISTS idx_workflow_definitions_key');

  const workflows = await knex('workflow_definitions').select('*').orderBy('created_at', 'asc');

  for (const workflow of workflows) {
    const isLegacyEmailWorkflow =
      workflow.workflow_id === LEGACY_EMAIL_WORKFLOW_ID ||
      workflow.key === LEGACY_EMAIL_WORKFLOW_KEY;

    if (workflow.tenant_id) {
      await knex('workflow_definitions')
        .where({ workflow_id: workflow.workflow_id })
        .update({
          is_system: false,
          ...(isLegacyEmailWorkflow ? { is_visible: false, is_paused: true } : {}),
        });
      continue;
    }

    const tenantIds = await collectTenantEvidence(knex, workflow);

    if (tenantIds.length === 0) {
      const isObsoleteSystemWorkflow = workflow.is_system === true || isLegacyEmailWorkflow;

      if (isObsoleteSystemWorkflow) {
        await deleteObsoleteLegacyWorkflow(knex, workflow);
        continue;
      }

      throw new Error(
        `Unable to infer tenant_id for workflow_definitions.${workflow.workflow_id}; ` +
        'refusing to continue with an unscoped workflow definition.'
      );
    }

    const [primaryTenantId, ...additionalTenantIds] = tenantIds.sort();

    for (const tenantId of additionalTenantIds) {
      await cloneWorkflowForTenant(knex, workflow, tenantId, {
        hide: isLegacyEmailWorkflow,
        pause: isLegacyEmailWorkflow,
      });
    }

    await knex('workflow_definitions')
      .where({ workflow_id: workflow.workflow_id })
      .update({
        tenant_id: primaryTenantId,
        is_system: false,
        ...(isLegacyEmailWorkflow ? { is_visible: false, is_paused: true } : {}),
        updated_at: new Date().toISOString(),
      });
  }

  const unresolved = await knex('workflow_definitions')
    .whereNull('tenant_id')
    .select('workflow_id', 'key', 'name');
  if (unresolved.length > 0) {
    throw new Error(
      `Found ${unresolved.length} workflow definitions without tenant_id after backfill: ` +
      unresolved.map((row) => `${row.workflow_id}${row.key ? ` (${row.key})` : ''}`).join(', ')
    );
  }

  await knex.raw('ALTER TABLE workflow_definitions ALTER COLUMN tenant_id SET NOT NULL');
  await ensureWorkflowDefinitionsCitusDistribution(knex);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_status ON workflow_definitions(tenant_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_updated ON workflow_definitions(tenant_id, updated_at)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_name ON workflow_definitions(tenant_id, name)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS workflow_definitions_tenant_key_unique ON workflow_definitions(tenant_id, key) WHERE key IS NOT NULL');
};

exports.down = async function down() {
  // Deliberately no-op. The up migration may split legacy shared definitions into
  // tenant-owned copies and reassign child rows; that data repair is not safely reversible.
};
