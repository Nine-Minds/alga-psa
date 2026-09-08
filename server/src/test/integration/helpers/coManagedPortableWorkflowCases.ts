import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { Knex } from 'knex';

export async function seedPortableWorkflowTaskHistory(f: any, definitionId = randomUUID()) {
  if (!await f.customer.table('workflow_task_definitions').where('task_definition_id', definitionId).first()) {
    await f.customer.table('workflow_task_definitions').insert({ tenant: f.actor.tenant, task_definition_id: definitionId,
      name: 'Portable business review', task_type: 'portable_business_review', form_type: 'tenant', created_by: f.actor.userId });
  }
  const taskId = randomUUID(), pendingId = randomUUID(), historyId = randomUUID(), formerUserId = randomUUID();
  const user = await f.customer.table('users').where('user_id', f.actor.userId).first();
  await f.customer.table('users').insert({ ...user, user_id: formerUserId, username: `former-${formerUserId}`, email: `former-${formerUserId}@example.test`,
    first_name: 'Former', last_name: 'Technician', is_inactive: true });
  const response = { accepted: true, comments: 'Customer business response survives departure' };
  await f.customer.table('workflow_tasks').insert([
    { tenant: f.actor.tenant, task_id: taskId, execution_id: randomUUID(), event_id: randomUUID(), task_definition_type: 'tenant',
      tenant_task_definition_id: definitionId, title: 'Completed customer review', status: 'completed', created_by: f.actor.userId,
      completed_by: formerUserId, completed_at: new Date(), response_data: response, context_data: { resolvedSecret: 'task-provider-secret-never-export' } },
    { tenant: f.actor.tenant, task_id: pendingId, execution_id: randomUUID(), task_definition_type: 'tenant', tenant_task_definition_id: definitionId,
      title: 'Claimed customer review', status: 'claimed', created_by: f.actor.userId, claimed_by: f.actor.userId, claimed_at: new Date() },
  ]);
  await f.customer.table('workflow_task_history').insert({ tenant: f.actor.tenant, history_id: historyId, task_id: taskId,
    action: 'complete', from_status: 'claimed', to_status: 'completed', user_id: f.actor.userId,
    details: { formData: response, providerContext: 'history-provider-secret-never-export' } });
  return { taskId, pendingId, historyId, formerUserId, definitionId, response };
}

export function registerCoManagedPortableWorkflowTests(getDb: () => Knex, fixture: () => Promise<any>) {
  async function authoredWorkflow() {
    const db = getDb(), f = await fixture(), workflowId = randomUUID(), versionId = randomUUID(), taskId = randomUUID();
    const formId = `customer-review-${randomUUID()}`, schemaId = `schema-${randomUUID()}`;
    const definition = { id: workflowId, version: 1, name: 'Customer routing', payloadSchemaRef: 'payload.TicketCreated.v1',
      trigger: { type: 'event', eventName: 'TICKET_CREATED' }, steps: [{ id: 'notify', type: 'action.call', config: {
        actionId: 'notifications.send_in_app', version: 1, inputMapping: { value: { $secret: 'CUSTOMER_API_TOKEN' },
          note: 'Customer authored literal', headers: { 'x-custom-token': 'customer-authored-literal-token' } } } }] };
    await f.customer.table('workflow_definitions').insert({ tenant: f.actor.tenant, workflow_id: workflowId, key: `portable-${workflowId}`,
      name: 'Customer routing', payload_schema_ref: 'payload.TicketCreated.v1', draft_definition: definition, draft_version: 2,
      trigger: definition.trigger, status: 'published', is_paused: false, created_by: f.actor.userId, updated_by: f.actor.userId,
      validation_context_json: { provider_credential: 'validation-cache-not-exportable' } });
    await f.customer.table('workflow_definition_versions').insert({ tenant: f.actor.tenant, version_id: versionId, workflow_id: workflowId,
      version: 1, definition_json: definition, payload_schema_json: { type: 'object', properties: { ticketId: { type: 'string' } } }, published_by: f.actor.userId });
    await f.customer.table('workflow_form_definitions').insert({ tenant: f.actor.tenant, form_id: formId, name: 'Customer review', version: '1.0', created_by: f.actor.userId });
    await f.customer.table('workflow_form_schemas').insert({ tenant: f.actor.tenant, schema_id: schemaId, form_id: formId,
      json_schema: { type: 'object', properties: { accepted: { type: 'boolean' } } }, default_values: { accepted: false } });
    await f.customer.table('workflow_task_definitions').insert({ tenant: f.actor.tenant, task_definition_id: taskId, name: 'Customer review task',
      task_type: 'customer_review', form_id: formId, form_type: 'tenant', created_by: f.actor.userId });
    await f.customer.table('workflow_runs').insert({ tenant: f.actor.tenant, workflow_id: workflowId, workflow_version: 1, status: 'running',
      lease_owner: 'runtime-lease-never-export', input_json: { resolvedSecret: 'runtime-provider-secret-never-export' } });
    await f.sponsor.table('workflow_definitions').insert({ tenant: f.principal.tenant, name: 'MSP private workflow never export',
      payload_schema_ref: 'payload.TicketCreated.v1', draft_definition: { ...definition, id: randomUUID() } });
    const business = await seedPortableWorkflowTaskHistory(f, taskId);
    const module = await import('../../../../../packages/co-managed/src/portableWorkflowExport');
    return { ...f, ...module, db, workflowId, versionId, formId, schemaId, taskId, definition, business,
      exportWorkflows: () => module.exportCoManagedPortableWorkflows(db, f.customerPrincipal, randomUUID()) };
  }

  it('portable workflow export preserves authored definitions versions and tenant forms after departure without runtime or secret-provider state', async () => {
    const f = await authoredWorkflow();
    await f.customer.table('co_management_relationships').update({ state: 'terminated', ended_at: new Date() });
    const result = await f.exportWorkflows();
    expect(result.records.workflow_definitions.find((row: any) => row.workflow_id === f.workflowId)).toMatchObject({ draft_definition: f.definition, draft_version: 2 });
    expect(result.records.workflow_definition_versions).toContainEqual(expect.objectContaining({ version_id: f.versionId, definition_json: f.definition, version: 1 }));
    expect(result.records.workflow_form_schemas).toContainEqual(expect.objectContaining({ schema_id: f.schemaId, form_id: f.formId, default_values: { accepted: false } }));
    expect(result.records.workflow_task_definitions).toContainEqual(expect.objectContaining({ task_definition_id: f.taskId, form_id: f.formId }));
    expect(result.records.workflow_tasks).toContainEqual(expect.objectContaining({ task_id: f.business.taskId, completed_by: f.business.formerUserId,
      completed_by_name: 'Former Technician', response_data: f.business.response }));
    expect(result.records.workflow_task_history).toContainEqual(expect.objectContaining({ history_id: f.business.historyId,
      task_id: f.business.taskId, details: { formData: f.business.response } }));
    expect(result.dependencies).toContainEqual(expect.objectContaining({ workflowId: f.workflowId, secretNames: ['CUSTOMER_API_TOKEN'],
      actions: [{ actionId: 'notifications.send_in_app', version: 1 }] }));
    expect(result.restorePolicy).toMatchObject({ workflowStatus: 'draft', workflowsPaused: true, secretReferences: 'reauthorize', authoredContent: 'encrypted_package_required', executionState: 'none' });
    for (const excluded of ['MSP private workflow never export', 'runtime-lease-never-export', 'runtime-provider-secret-never-export',
      'validation-cache-not-exportable', 'validation_context_json', 'tenant_secrets', 'workflow_runs', 'context_data', 'execution_id', 'event_id', 'claimed_by',
      'task-provider-secret-never-export', 'history-provider-secret-never-export']) expect(JSON.stringify(result)).not.toContain(excluded);
    expect(JSON.stringify(result)).toContain('customer-authored-literal-token');
    const { sha256, ...payload } = result;
    expect(sha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    const brokenForm = structuredClone(result.records); brokenForm.workflow_task_definitions[0].form_id = 'missing-customer-form';
    expect(() => f.validateCoManagedPortableWorkflowRecords(brokenForm)).toThrow('task form is missing');
    const duplicateVersion = structuredClone(result.records); duplicateVersion.workflow_definition_versions.push({ ...duplicateVersion.workflow_definition_versions[0], version_id: randomUUID() });
    expect(() => f.validateCoManagedPortableWorkflowRecords(duplicateVersion)).toThrow('Duplicate portable workflow version');
  });

  it('portable workflow export enforces current customer sessions native export permission and definition redactions', async () => {
    const f = await authoredWorkflow();
    await expect(f.exportCoManagedPortableWorkflows(f.db, f.principal, randomUUID())).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: f.db.fn.now() });
    await expect(f.exportWorkflows()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: null });
    const bundles = await import('@alga-psa/authorization');
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(f.db, { tenant: f.actor.tenant, name: 'Workflow export scope', actorUserId: f.actor.userId });
    await bundles.upsertBundleRule(f.db, { tenant: f.actor.tenant, bundleId, revisionId, resourceType: 'workflow', action: 'read',
      templateKey: 'own', config: { redactedFields: ['draft_definition'] } });
    await bundles.publishBundleRevision(f.db, { tenant: f.actor.tenant, bundleId, revisionId, actorUserId: f.actor.userId });
    await bundles.createBundleAssignment(f.db, { tenant: f.actor.tenant, bundleId, targetType: 'user', targetId: f.actor.userId });
    await expect(f.exportWorkflows()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('authorization_bundle_rules').where('revision_id', revisionId).update({ config: {} });
    expect((await f.exportWorkflows()).records.workflow_definitions.some((row: any) => row.workflow_id === f.workflowId)).toBe(true);
    const permission = await f.customer.table('permissions').where({ resource: 'workflow', action: 'admin', msp: true }).first();
    await f.customer.table('role_permissions').where('permission_id', permission.permission_id).delete();
    await expect(f.exportWorkflows()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });

  it('portable workflow business history rejects task field redaction and foreign task-history parents', async () => {
    const f = await authoredWorkflow(), bundles = await import('@alga-psa/authorization');
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(f.db, { tenant: f.actor.tenant, name: 'Task response export scope', actorUserId: f.actor.userId });
    await bundles.upsertBundleRule(f.db, { tenant: f.actor.tenant, bundleId, revisionId, resourceType: 'workflow', action: 'read',
      templateKey: 'own', config: { redactedFields: ['workflow_tasks.response_data'] } });
    await bundles.publishBundleRevision(f.db, { tenant: f.actor.tenant, bundleId, revisionId, actorUserId: f.actor.userId });
    await bundles.createBundleAssignment(f.db, { tenant: f.actor.tenant, bundleId, targetType: 'user', targetId: f.actor.userId });
    await expect(f.exportWorkflows()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('authorization_bundle_rules').where('revision_id', revisionId).update({ config: {} });
    const foreignHistoryId = randomUUID();
    await expect(f.sponsor.table('workflow_task_history').insert({ tenant: f.principal.tenant, history_id: foreignHistoryId,
      task_id: f.business.taskId, action: 'complete', user_id: f.principal.userId, details: { formData: { note: 'MSP response never export' } } }))
      .rejects.toMatchObject({ constraint: 'workflow_task_history_task_id_tenant_foreign' });
    const foreign = await seedPortableWorkflowTaskHistory({ ...f, actor: f.principal, customer: f.sponsor });
    const exported = await f.exportWorkflows();
    expect(JSON.stringify(exported)).not.toContain(foreignHistoryId); expect(JSON.stringify(exported)).not.toContain(foreign.taskId);
    const invalid = structuredClone(exported.records); invalid.workflow_task_history[0].details = { formData: {}, token: 'not part of a business response' };
    expect(() => f.validateCoManagedPortableWorkflowRecords(invalid)).toThrow('history details');
  });
}
