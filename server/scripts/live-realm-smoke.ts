/**
 * Live realm-scoping smoke: runs the REAL sync repositories and appliers
 * against the running dev DB and the wire QBO emulator (two company files with
 * deliberately colliding entity ids). Temporary verification harness — invoked
 * manually; cleans up the rows it creates.
 *
 *   cd server && QBO_API_BASE_URL=http://localhost:4021/v3/company \
 *     QBO_OAUTH_TOKEN_URL=http://localhost:4021/oauth2/v1/tokens/bearer \
 *     npx tsx scripts/live-realm-smoke.ts
 */
const iop = async (path: string) => {
  const mod: any = await import(path);
  return mod.default && !mod.SyncMappingLedger && !mod.drainVoidInvoiceOps && !mod.emptyCycleStats && !mod.SyncOperationsRepository ? mod.default : mod;
};
const { getAdminConnection } = await iop('@alga-psa/db/admin');
const { SyncMappingLedger } = await iop('../../packages/billing/src/services/accountingSync/syncMappingLedger.ts');
const { SyncOperationsRepository } = await iop('../../packages/billing/src/services/accountingSync/syncOperationsRepository.ts');
const { drainVoidInvoiceOps } = await iop('../../packages/billing/src/services/accountingSync/invoiceVoidApplier.ts');
const { emptyCycleStats } = await iop('../../packages/billing/src/services/accountingSync/accountingSync.types.ts');

const TENANT = '6d178771-ad9a-4d43-8809-83992745f8f9';
const ADAPTER = 'quickbooks_online';
const REALM_A = 'realm-sim';
const REALM_B = 'realm-two';
const CONTROL = 'http://localhost:9501';

async function control(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return (await res.json()).result;
}

/** Seed one invoice per company; same seeding order → same (colliding) Id. */
async function seedCollidingInvoicePair(amountCents: number): Promise<string> {
  const a = await control('/control/qbo/seed/invoice', { customerId: 'customer-1', amountCents, realmId: REALM_A });
  const b = await control('/control/qbo/seed/invoice', { customerId: 'customer-1', amountCents, realmId: REALM_B });
  if (a.Id !== b.Id) throw new Error(`Seeded ids diverged: ${a.Id} vs ${b.Id}`);
  return a.Id;
}

async function emulatorInvoice(realm: string, id: string): Promise<any> {
  const rows = await control('/control/qbo/actions/entities', { entityType: 'Invoice', realmId: realm });
  return rows.find((row: any) => row.Id === id);
}

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(label);
}

async function main() {
  const knex = await getAdminConnection();
  const ops = new SyncOperationsRepository(knex);
  const ledger = new SyncMappingLedger(knex, TENANT, ADAPTER);
  const exceptions = {
    createOrUpdate: async () => ({ created: false }),
    resolve: async () => undefined
  } as any;

  const { randomUUID } = await import('crypto');
  const algaId = randomUUID();
  const legacyAlgaId = randomUUID();
  const smokeAlgaIds = [algaId, legacyAlgaId];
  const cleanupOpIds: string[] = [];

  try {
    // ── Scenario 1: valid sync — void drains against the mapped realm A ──
    const inv1 = await seedCollidingInvoicePair(10_000);
    await ledger.insert({
      algaEntityType: 'invoice',
      algaEntityId: algaId,
      externalEntityId: inv1,
      targetRealm: REALM_A
    });
    const op1 = await ops.enqueue({
      tenant: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM_A,
      operation: 'void_invoice',
      algaEntityType: 'invoice',
      algaEntityId: algaId
    });
    cleanupOpIds.push(op1.op_id);
    await drainVoidInvoiceOps({
      knex, tenantId: TENANT, adapterType: ADAPTER, targetRealm: REALM_A,
      ops, ledger, exceptions, stats: emptyCycleStats()
    });
    const op1After = await knex('accounting_sync_operations').where({ tenant: TENANT, op_id: op1.op_id }).first();
    if (op1After?.status !== 'done') console.log('scenario 1 op:', op1After?.status, op1After?.last_error ?? '');
    const afterA = await emulatorInvoice(REALM_A, inv1);
    const afterB = await emulatorInvoice(REALM_B, inv1);
    check('valid sync voids only realm A copy', afterA.Balance === 0 && afterB.Balance > 0, { afterA, afterB });

    // ── Scenario 2: default realm changed — op targets realm B, mapping is realm A ──
    const algaId2 = randomUUID();
    smokeAlgaIds.push(algaId2);
    const inv2 = await seedCollidingInvoicePair(20_000);
    await ledger.insert({
      algaEntityType: 'invoice',
      algaEntityId: algaId2,
      externalEntityId: inv2,
      targetRealm: REALM_A
    });
    const op2 = await ops.enqueue({
      tenant: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM_B,
      operation: 'void_invoice',
      algaEntityType: 'invoice',
      algaEntityId: algaId2
    });
    cleanupOpIds.push(op2.op_id);
    const balanceBefore = (await emulatorInvoice(REALM_B, inv2)).Balance;
    await drainVoidInvoiceOps({
      knex, tenantId: TENANT, adapterType: ADAPTER, targetRealm: REALM_B,
      ops, ledger, exceptions, stats: emptyCycleStats()
    });
    const op2After = await knex('accounting_sync_operations').where({ tenant: TENANT, op_id: op2.op_id }).first();
    const balanceAfter = (await emulatorInvoice(REALM_B, inv2)).Balance;
    const balanceAAfter = (await emulatorInvoice(REALM_A, inv2)).Balance;
    check(
      'realm-switched op fails; other company untouched',
      op2After?.status !== 'done' && balanceAfter === balanceBefore && balanceAAfter > 0,
      { status: op2After?.status, balanceBefore, balanceAfter }
    );

    // ── Scenario 3: realm-less legacy mapping is never used for a write ──
    const inv3 = await seedCollidingInvoicePair(30_000);
    await knex('tenant_external_entity_mappings').insert({
      tenant: TENANT,
      integration_type: ADAPTER,
      alga_entity_type: 'invoice',
      alga_entity_id: legacyAlgaId,
      external_entity_id: inv3,
      external_realm_id: null,
      sync_status: 'needs_realm_review'
    });
    const op3 = await ops.enqueue({
      tenant: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM_B,
      operation: 'void_invoice',
      algaEntityType: 'invoice',
      algaEntityId: legacyAlgaId
    });
    cleanupOpIds.push(op3.op_id);
    const bBefore = (await emulatorInvoice(REALM_B, inv3)).Balance;
    await drainVoidInvoiceOps({
      knex, tenantId: TENANT, adapterType: ADAPTER, targetRealm: REALM_B,
      ops, ledger, exceptions, stats: emptyCycleStats()
    });
    const op3After = await knex('accounting_sync_operations').where({ tenant: TENANT, op_id: op3.op_id }).first();
    const bAfter = (await emulatorInvoice(REALM_B, inv3)).Balance;
    const aAfter3 = (await emulatorInvoice(REALM_A, inv3)).Balance;
    check(
      'legacy realm-less mapping never drives a void',
      op3After?.status !== 'done' && bAfter === bBefore && aAfter3 > 0,
      { status: op3After?.status, bBefore, bAfter }
    );
  } finally {
    await knex('accounting_sync_operations').where({ tenant: TENANT }).whereIn('op_id', cleanupOpIds).del();
    await knex('tenant_external_entity_mappings')
      .where({ tenant: TENANT, integration_type: ADAPTER })
      .whereIn('alga_entity_id', smokeAlgaIds)
      .del();
    await knex.destroy();
  }

  if (failures.length) {
    console.error(`\n${failures.length} scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll live realm-scoping scenarios passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
