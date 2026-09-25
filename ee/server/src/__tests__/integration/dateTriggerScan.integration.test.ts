import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { knex as createKnex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getPlaywrightDbConfig } from './utils/playwrightDatabaseConfig';
import { createDateTriggerScanHandler } from '../../../../../packages/jobs/src/lib/handlers/dateTriggerScanHandler';
import { emitDateDomainEventOnce, normalizeDateDomainKeyDate, toTenantLocalDate } from '../../../../../packages/event-bus/src/workflow/dateDomainEvents';
import { launchDateTriggeredWorkflows, buildDateTriggerFireKey } from '../../../../packages/workflows/src/lib/dateTriggerLauncher';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), temporalStart: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: mocks.publish }));
vi.mock('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal')),
  startWorkflowRuntimeV2TemporalRun: mocks.temporalStart,
}));

const enabled = process.env.DATE_TRIGGER_INTEGRATION === '1';

describe.skipIf(!enabled)('date trigger scan and workflow launch integration', () => {
  const config = getPlaywrightDbConfig();
  const db = createKnex({ client: 'pg', connection: { host: config.host, port: config.port, database: config.database, user: config.adminUser, password: config.adminPassword, ssl: config.ssl }, pool: { min: 0, max: 2 } });
  beforeAll(() => {
    mocks.publish.mockResolvedValue(undefined);
    mocks.temporalStart.mockImplementation(async ({ runId }: { runId: string }) => ({ workflowId: `stub:${runId}`, firstExecutionRunId: null }));
  });
  afterAll(async () => { await db.destroy(); });

  it('creates three real deduped runs and one ledger publish per event, then shares keys with save emitters', async () => {
    const tenantRow = await db('tenants').first('tenant');
    if (!tenantRow) throw new Error('The integration database must have its standard tenant seed.');
    const tenantId = String(tenantRow.tenant);
    const clientId = uuidv4();
    const contractId = uuidv4();
    const clientContractId = uuidv4();
    const assetId = uuidv4();
    const workflowIds = [uuidv4(), uuidv4(), uuidv4()];
    const fireDate = '2026-10-01';
    const fixtures = [
      { source: 'client.anniversary', offsetDays: -30, ref: 'payload.ClientAnniversary.v1', entityId: clientId, occursOn: '2026-10-31', eventType: 'CLIENT_ANNIVERSARY_UPCOMING', expectedPayload: { clientId, clientName: 'Date scan launch fixture', yearsAsClient: 6, anniversarySource: 'client_since' } },
      { source: 'contract.renewal_decision', offsetDays: -60, ref: 'payload.ContractRenewalDate.v1', entityId: clientContractId, occursOn: '2026-11-30', eventType: 'CONTRACT_RENEWAL_UPCOMING', expectedPayload: { contractId, clientContractId, clientId, clientName: 'Date scan launch fixture', decisionDueDate: '2026-11-30', renewalMode: 'manual' } },
      { source: 'asset.warranty_end', offsetDays: 0, ref: 'payload.AssetWarrantyEnd.v1', entityId: assetId, occursOn: fireDate, eventType: 'ASSET_WARRANTY_EXPIRING', expectedPayload: { assetId, assetName: 'Warranty fixture', warrantyEndDate: fireDate } },
    ];
    const trx = await db.transaction();
    try {
      await trx('tenant_settings').where({ tenant: tenantId }).update({ settings: trx.raw("COALESCE(settings, '{}'::jsonb) || '{\"timezone\":\"UTC\"}'::jsonb") });
      await trx('clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Date scan launch fixture', client_since: '2020-10-31', created_at: '2020-10-31T00:00:00Z', updated_at: '2020-10-31T00:00:00Z' });
      await trx('contracts').insert({ tenant: tenantId, contract_id: contractId, contract_name: 'Date scan launch contract' });
      await trx('client_contracts').insert({ tenant: tenantId, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId, start_date: '2020-01-01', end_date: '2027-01-01', decision_due_date: '2026-11-30', renewal_cycle_key: null, renewal_mode: 'manual', is_active: true });
      await trx('assets').insert({ tenant: tenantId, asset_id: assetId, asset_tag: `date-${assetId}`, name: 'Warranty fixture', status: 'active', asset_type: 'hardware', client_id: clientId, warranty_end_date: `${fireDate}T18:00:00Z` });

      for (let i = 0; i < fixtures.length; i += 1) {
        const fixture = fixtures[i];
        const workflowId = workflowIds[i];
        const definition = { trigger: { type: 'date', source: fixture.source, offsetDays: fixture.offsetDays, localTime: '08:00', timezone: 'UTC' }, payloadSchemaRef: fixture.ref, steps: [] };
        await trx('workflow_definitions').insert({ workflow_id: workflowId, tenant: tenantId, name: `Date scan ${fixture.source}`, payload_schema_ref: fixture.ref, trigger: JSON.stringify(definition.trigger), draft_definition: JSON.stringify(definition), draft_version: 1, status: 'published' });
        await trx('workflow_definition_versions').insert({ workflow_id: workflowId, version: 1, definition_json: JSON.stringify(definition), published_at: fireDate });
      }

      // Regression probe: OID 1082 is parsed by node-postgres as a local-midnight Date.
      const parsedDate = await trx.raw("SELECT '2026-11-30'::date AS due_date");
      expect(parsedDate.rows[0].due_date).toBeInstanceOf(Date);
      const decisionDate = normalizeDateDomainKeyDate(parsedDate.rows[0].due_date);
      expect(decisionDate).toBe('2026-11-30');

      const handler = createDateTriggerScanHandler(
        (params) => launchDateTriggeredWorkflows(params),
        () => new Date(`${fireDate}T12:00:00.000Z`),
        async () => 'UTC',
        async () => ({ knex: trx }),
      );
      await handler({ tenantId });
      const runsAfterFirst = await trx('workflow_runs').whereIn('workflow_id', workflowIds).select('workflow_id', 'trigger_fire_key', 'input_json');
      expect(runsAfterFirst).toHaveLength(3);
      for (let i = 0; i < fixtures.length; i += 1) {
        const fixture = fixtures[i];
        const workflowId = workflowIds[i];
        const expectedKey = buildDateTriggerFireKey(workflowId, fixture.source, fixture.entityId, fixture.occursOn, fixture.offsetDays);
        const run = runsAfterFirst.find((row: any) => row.workflow_id === workflowId);
        expect(run.trigger_fire_key).toBe(expectedKey);
        expect(run.input_json).toMatchObject({ ...fixture.expectedPayload, occursOn: fixture.occursOn, fireDate, offsetDays: fixture.offsetDays });
      }
      expect(mocks.publish).toHaveBeenCalledTimes(3);
      expect(mocks.publish.mock.calls.map(([event]) => event.eventType).sort()).toEqual(['ASSET_WARRANTY_EXPIRING', 'CLIENT_ANNIVERSARY_UPCOMING', 'CONTRACT_RENEWAL_UPCOMING']);

      await handler({ tenantId });
      expect(await trx('workflow_runs').whereIn('workflow_id', workflowIds)).toHaveLength(3);
      expect(mocks.publish).toHaveBeenCalledTimes(3);
      const ledger = await trx('date_trigger_emissions').where({ tenant: tenantId }).whereIn('event_type', ['CLIENT_ANNIVERSARY_UPCOMING', 'CONTRACT_RENEWAL_UPCOMING', 'ASSET_WARRANTY_EXPIRING']).select('event_type');
      expect(ledger.map((row: any) => row.event_type).sort()).toEqual(['ASSET_WARRANTY_EXPIRING', 'CLIENT_ANNIVERSARY_UPCOMING', 'CONTRACT_RENEWAL_UPCOMING']);

      // Mirrors save-time contract key precedence: renewal_cycle_key, otherwise normalized decision date.
      const savedContract = await trx('client_contracts').where({ tenant: tenantId, client_contract_id: clientContractId }).first('decision_due_date', 'renewal_cycle_key');
      expect(savedContract.decision_due_date).toBeInstanceOf(Date);
      const cycleKey = savedContract.renewal_cycle_key ?? normalizeDateDomainKeyDate(savedContract.decision_due_date);
      const published = await emitDateDomainEventOnce(trx, tenantId, {
        eventType: 'CONTRACT_RENEWAL_UPCOMING', entityId: clientContractId, cycleKey,
        occursOn: normalizeDateDomainKeyDate(savedContract.decision_due_date), payload: {},
      });
      expect(published).toBe(false);
      const savedAsset = await trx('assets').where({ tenant: tenantId, asset_id: assetId }).first('warranty_end_date');
      const warrantyDate = toTenantLocalDate(savedAsset.warranty_end_date, 'UTC');
      await expect(emitDateDomainEventOnce(trx, tenantId, {
        eventType: 'ASSET_WARRANTY_EXPIRING', entityId: assetId, cycleKey: warrantyDate,
        occursOn: warrantyDate, payload: {},
      })).resolves.toBe(false);
      expect(mocks.publish).toHaveBeenCalledTimes(3);
    } finally {
      await trx.rollback();
    }
  });
});
