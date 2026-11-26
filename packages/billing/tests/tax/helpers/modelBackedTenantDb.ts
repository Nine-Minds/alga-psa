/**
 * Mock wiring for the TaxService unit suites.
 *
 * These suites stub the `ClientTaxSettings` model (settings, composite
 * components, brackets, holidays) and fake knex for everything else. The tax
 * arithmetic now lives in `shared/billingClients/taxEngine`, which reads those
 * four things through `tenantDb(...)` rather than through the session-bound
 * model. This facade routes those reads back to the same model stubs, so each
 * test keeps feeding its data the way it always has and no assertion changes.
 */

// Loaded lazily: this helper is imported from inside `vi.mock('@alga-psa/db')`
// factories, and the model (real or automocked) itself imports `@alga-psa/db`.
const loadModel = async () => (await import('../../../src/models/clientTaxSettings')).default;

function modelBuilder(load: (where: Record<string, any>) => Promise<any>) {
  const builder: any = {};
  const where: Record<string, any> = {};
  for (const method of ['where', 'andWhere', 'orderBy', 'select', 'whereNull', 'orWhere']) {
    builder[method] = (arg?: unknown) => {
      if (arg && typeof arg === 'object') Object.assign(where, arg);
      return builder;
    };
  }
  builder.first = async () => {
    const value = await load(where);
    return Array.isArray(value) ? value[0] : (value ?? undefined);
  };
  builder.then = (onFulfilled: any, onRejected: any) =>
    load(where)
      .then((value) => (Array.isArray(value) ? value : value == null ? [] : [value]))
      .then(onFulfilled, onRejected);
  return builder;
}

export function modelBackedTenantDb(knex: (table: string) => any) {
  return {
    table: (table: string) => {
      if (table === 'client_billing_profiles') {
        return modelBuilder(async () => ({ billing_profile_id: 'profile-1' }));
      }
      if (table === 'client_tax_settings') {
        return modelBuilder(async (where) => (await loadModel()).get(where.client_id));
      }
      return knex(table);
    },
    unscoped: (table: string) => knex(table),
    parentScopedTable: (table: string) => {
      if (table.startsWith('composite_tax_mappings')) {
        return modelBuilder(async () => (await loadModel()).getCompositeTaxComponents('rate'));
      }
      if (table === 'tax_rate_thresholds') {
        return modelBuilder(async () => (await loadModel()).getTaxRateThresholds('rate'));
      }
      if (table === 'tax_holidays') {
        return modelBuilder(async () => (await loadModel()).getTaxHolidays('rate'));
      }
      throw new Error(`Unexpected parent-scoped table ${table}`);
    },
    tenantJoin: () => undefined,
  };
}
