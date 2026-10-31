/**
 * Service principals (F007): the `service_principal` RBAC resource, granted to
 * the MSP Admin role of every PSA tenant. Contributed to the shared permission
 * catalog (server/migrations/utils/permissions/catalog.cjs), so new tenants get
 * it through onboarding/seed reconciliation exactly like every other resource.
 * Existing tenants got it from migration 20261018100100.
 */
const grant = { psa: ['msp:Admin'] };

module.exports = [
  { resource: 'service_principal', action: 'create', msp: true, client: false, description: 'Create service principals', products: ['psa'], defaultGrants: grant },
  { resource: 'service_principal', action: 'delete', msp: true, client: false, description: 'Delete or archive service principals', products: ['psa'], defaultGrants: grant },
  { resource: 'service_principal', action: 'read', msp: true, client: false, description: 'View service principals', products: ['psa'], defaultGrants: grant },
  { resource: 'service_principal', action: 'update', msp: true, client: false, description: 'Update service principals, including act-as', products: ['psa'], defaultGrants: grant },
];
