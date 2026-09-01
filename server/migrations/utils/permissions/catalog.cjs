/**
 * Executable permission catalog — the single source of truth for the system
 * permissions both products provision and for the default-role grants that come
 * with them.
 *
 * Identity is the database representation: (resource, action, msp, client). The
 * tenant is supplied at synchronization time and is never stored here.
 *
 * Synchronization is MINIMUM state, never exact state: entries are inserted and
 * canonical descriptions refreshed; nothing outside the catalog is touched and
 * nothing is ever deleted. See ./README.md.
 *
 * ACTIVE_PERMISSIONS is the only list any code path inserts. A permission that
 * should no longer be provisioned is simply removed from the list:
 * synchronization never deletes, so existing tenant rows are left alone.
 */

const crypto = require('crypto');

const PRODUCTS = ['algadesk', 'psa'];

/**
 * Legacy resource spellings and the catalog name that replaced them.
 *
 * These three resources were the only ones whose stored name disagreed with the
 * name the rest of the system uses for the same thing (the `time_entries` /
 * `time_sheets` / `time_periods` tables, the search object types, the
 * authorization kernel's resource types, the v1 API resources). RBAC papered
 * over the first two with a per-check translation table duplicated across six
 * modules and never covered `timeperiod` at all, so the v1 time-period
 * endpoints denied every caller; the rename migration that consumes this map
 * removes the need for the translation and closes that gap.
 *
 * Exact resource names only — `timeentry_settings` is a different (retired)
 * resource and is deliberately not renamed.
 */
const RENAMED_RESOURCES = {
  timeentry: 'time_entry',
  timeperiod: 'time_period',
  timesheet: 'time_sheet',
};

/** Catalog name for a possibly-legacy resource spelling. */
function canonicalResource(resource) {
  return RENAMED_RESOURCES[resource] || resource;
}

const ACTIVE_PERMISSIONS = [
  { resource: 'account_management', action: 'delete', msp: true, client: false, description: 'Delete account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'account_management', action: 'read', msp: true, client: false, description: 'Read account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'account_management', action: 'update', msp: true, client: false, description: 'Update account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  // Remote accounting catalogs (QuickBooks Online / Xero customers, accounts,
  // classes, departments, items, tax codes, terms, tracking categories) and the
  // accounting entity-mapping reads that pair local records with them. Narrower
  // than billing_settings:read on purpose: connection diagnostics stay on
  // billing_settings while catalog contents require this grant.
  { resource: 'accounting_catalog', action: 'read', msp: true, client: false, description: 'View remote accounting catalogs (QuickBooks Online, Xero) and accounting entity mappings', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'asset', action: 'create', msp: true, client: false, description: 'Create new assets and equipment records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'asset', action: 'delete', msp: true, client: false, description: 'Remove assets from the system', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'asset', action: 'read', msp: true, client: false, description: 'View asset details and inventory', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'asset', action: 'update', msp: true, client: false, description: 'Modify asset information and status', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },

  { resource: 'billing', action: 'create', msp: true, client: false, description: 'Create billing records and charges', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'create', msp: false, client: true, description: 'Create billing entries in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'billing', action: 'delete', msp: true, client: false, description: 'Remove billing records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'read', msp: true, client: false, description: 'View billing information and history', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'billing', action: 'read', msp: false, client: true, description: 'View billing information in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'client:Finance'] } },
  { resource: 'billing', action: 'update', msp: true, client: false, description: 'Modify billing records and rates', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'update', msp: false, client: true, description: 'Update billing entries in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },

  { resource: 'billing.recurring_service_periods', action: 'correct_history', msp: true, client: false, description: 'Correct the billed history of recurring service periods', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'billing.recurring_service_periods', action: 'regenerate', msp: true, client: false, description: 'Regenerate recurring service periods for a schedule', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'billing.recurring_service_periods', action: 'view', msp: true, client: false, description: 'View recurring service periods and their billing state', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },

  { resource: 'billing_profile_report', action: 'read', msp: true, client: false, description: 'View spend broken down by billing profile', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager'] } },

  { resource: 'billing_settings', action: 'create', msp: true, client: false, description: 'Create billing configuration profiles', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing_settings', action: 'delete', msp: true, client: false, description: 'Remove billing configuration profiles', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing_settings', action: 'read', msp: true, client: false, description: 'View billing rates and rules', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'billing_settings', action: 'update', msp: true, client: false, description: 'Modify billing rates and configuration', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'client', action: 'create', msp: true, client: false, description: 'Add new client accounts', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'client', action: 'create', msp: false, client: true, description: 'Create client information', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'client', action: 'delete', msp: true, client: false, description: 'Remove client accounts', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'client', action: 'delete', msp: false, client: true, description: 'Delete client information', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'client', action: 'read', msp: true, client: false, description: 'View client information and details', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'client', action: 'read', msp: false, client: true, description: 'Read client information', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'client', action: 'update', msp: true, client: false, description: 'Modify client account information', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'client', action: 'update', msp: false, client: true, description: 'Update client information', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },

  { resource: 'contact', action: 'create', msp: true, client: false, description: 'Add new contacts to companies', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'contact', action: 'delete', msp: true, client: false, description: 'Remove contacts from the system', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'contact', action: 'read', msp: true, client: false, description: 'View contact information', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'contact', action: 'read', msp: false, client: true, description: 'Read contacts', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin', 'client:User'] } },
  { resource: 'contact', action: 'update', msp: true, client: false, description: 'Edit contact details', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'contact', action: 'update', msp: false, client: true, description: 'Update contacts', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },

  { resource: 'credential', action: 'audit', msp: true, client: false, description: 'View the credentials vault audit log', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'credential', action: 'create', msp: true, client: false, description: 'Create credentials in the vault', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'credential', action: 'delete', msp: true, client: false, description: 'Delete credentials from the vault', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'credential', action: 'read', msp: true, client: false, description: 'View credential metadata and the credentials vault', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'credential', action: 'reveal', msp: true, client: false, description: 'Reveal the plaintext value of a credential', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'credential', action: 'update', msp: true, client: false, description: 'Update credentials and their access grants', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },

  { resource: 'credit', action: 'create', msp: true, client: false, description: 'Issue credits to accounts', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'delete', msp: true, client: false, description: 'Remove credit records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'read', msp: true, client: false, description: 'View credit balances and history', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'transfer', msp: true, client: false, description: 'Transfer credits between accounts', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'update', msp: true, client: false, description: 'Modify credit amounts and details', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'cycle_count', action: 'approve', msp: true, client: false, description: 'Approve cycle counts and post the resulting stock adjustments', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'create', msp: true, client: false, description: 'Start inventory cycle count sessions', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'read', msp: true, client: false, description: 'View cycle count sessions and their variances', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'update', msp: true, client: false, description: 'Record counts on an open cycle count session', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'document', action: 'create', msp: true, client: false, description: 'Create documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'create', msp: false, client: true, description: 'Create documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents from the system', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'document', action: 'read', msp: true, client: false, description: 'Read documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'read', msp: false, client: true, description: 'Read documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'document', action: 'update', msp: true, client: false, description: 'Update documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'update', msp: false, client: true, description: 'Update documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },

  { resource: 'email', action: 'process', msp: true, client: false, description: 'Process outbound email', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'extension', action: 'read', msp: true, client: false, description: 'Read extension APIs and storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'extension', action: 'write', msp: true, client: false, description: 'Write extension APIs and storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'financial', action: 'create', msp: true, client: false, description: 'Create financial records (transactions, payment methods, prepayment invoices)', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'delete', msp: true, client: false, description: 'Delete financial records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'read', msp: true, client: false, description: 'View financial data (transactions, credits, reports)', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'transfer', msp: true, client: false, description: 'Transfer credits between clients', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'update', msp: true, client: false, description: 'Update financial records (apply credits, reconciliation)', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'import_export', action: 'manage', msp: true, client: false, description: 'Create and execute asset imports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'import_export', action: 'read', msp: true, client: false, description: 'View asset import/export settings and history', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'inbound_webhook', action: 'create', msp: true, client: false, description: 'Create inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'delete', msp: true, client: false, description: 'Delete inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'read', msp: true, client: false, description: 'View inbound webhooks and deliveries', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'replay', msp: true, client: false, description: 'Replay inbound webhook deliveries', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'update', msp: true, client: false, description: 'Update inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'interaction', action: 'create', msp: true, client: false, description: 'Create interactions (calls, notes, check-ins, activity)', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'interaction', action: 'delete', msp: true, client: false, description: 'Delete interactions', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'interaction', action: 'read', msp: true, client: false, description: 'View interactions', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'interaction', action: 'update', msp: true, client: false, description: 'Update interactions', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'inventory', action: 'create', msp: true, client: false, description: 'Create inventory records', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'delete', msp: true, client: false, description: 'Delete inventory records', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'read', msp: true, client: false, description: 'View inventory records', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'update', msp: true, client: false, description: 'Update inventory records', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'invoice', action: 'create', msp: true, client: false, description: 'Create new invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'credit', msp: true, client: false, description: 'Apply credits to invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete draft invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'finalize', msp: true, client: false, description: 'Finalize and lock invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'generate', msp: true, client: false, description: 'Generate invoices from billable items', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'read', msp: true, client: false, description: 'View invoice details and history', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'invoice', action: 'send', msp: true, client: false, description: 'Send invoices to clients', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'update', msp: true, client: false, description: 'Modify invoice line items and details', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'void', msp: true, client: false, description: 'Void invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'job', action: 'delete', msp: true, client: false, description: 'Clear job monitoring history', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'marketing', action: 'manage', msp: true, client: false, description: 'Manage marketing campaigns, content, posts, sequences, and forms', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'marketing', action: 'read', msp: true, client: false, description: 'View marketing campaigns, content, posts, and sequences', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'notification', action: 'manage', msp: true, client: false, description: 'Manage notifications', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'notification', action: 'read', msp: true, client: false, description: 'Read notifications', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'opportunities', action: 'create', msp: true, client: false, description: 'Create opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'delete', msp: true, client: false, description: 'Delete opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'read', msp: true, client: false, description: 'View opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'update', msp: true, client: false, description: 'Update opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'priority', action: 'create', msp: true, client: false, description: 'Create ticket priorities', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'project', action: 'create', msp: true, client: false, description: 'Create new projects', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project', action: 'create', msp: false, client: true, description: 'Create projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'project', action: 'delete', msp: true, client: false, description: 'Delete projects and associated data', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project', action: 'delete', msp: false, client: true, description: 'Delete projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'project', action: 'read', msp: true, client: false, description: 'View projects', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project', action: 'read', msp: false, client: true, description: 'View projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'project', action: 'update', msp: true, client: false, description: 'Modify project information and timeline', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'project', action: 'update', msp: false, client: true, description: 'Update projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },

  { resource: 'project_task', action: 'create', msp: true, client: false, description: 'Create new project tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project_task', action: 'delete', msp: true, client: false, description: 'Delete project tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project_task', action: 'read', msp: true, client: false, description: 'View project tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project_task', action: 'update', msp: true, client: false, description: 'Modify project task information', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'purchase_order', action: 'create', msp: true, client: false, description: 'Create purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'delete', msp: true, client: false, description: 'Delete purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'read', msp: true, client: false, description: 'View purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'update', msp: true, client: false, description: 'Update purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'quotes', action: 'approve', msp: true, client: false, description: 'Approve or request changes to quotes pending internal approval', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'reports', action: 'create', msp: true, client: false, description: 'Create reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'reports', action: 'delete', msp: true, client: false, description: 'Delete reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'reports', action: 'read', msp: true, client: false, description: 'Read reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'reports', action: 'update', msp: true, client: false, description: 'Update reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'rmm', action: 'execute_command', msp: true, client: false, description: 'Execute raw RMM remote commands', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'sales_order', action: 'create', msp: true, client: false, description: 'Create sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'delete', msp: true, client: false, description: 'Delete sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'read', msp: true, client: false, description: 'View sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'update', msp: true, client: false, description: 'Update sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'secrets', action: 'manage', msp: true, client: false, description: 'Create, update, and delete secrets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'secrets', action: 'view', msp: true, client: false, description: 'View secret names and metadata (not values)', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'security_settings', action: 'create', msp: true, client: false, description: 'Create security settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'delete', msp: true, client: false, description: 'Delete security settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'read', msp: true, client: false, description: 'View security policies and settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'update', msp: true, client: false, description: 'Configure security policies and access controls', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services/products in the service catalog', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'service', action: 'delete', msp: true, client: false, description: 'Archive/delete services/products in the service catalog', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'service', action: 'read', msp: true, client: false, description: 'View services/products in the service catalog', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'service', action: 'update', msp: true, client: false, description: 'Update services/products in the service catalog', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'settings', action: 'create', msp: true, client: true, description: 'Create portal settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'settings', action: 'delete', msp: true, client: true, description: 'Delete portal settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: true, client: false, description: 'View portal settings', products: ['algadesk'], defaultGrants: { algadesk: ['msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: true, client: true, description: 'View portal settings', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: false, client: true, description: 'View settings in client portal', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },
  { resource: 'settings', action: 'update', msp: true, client: false, description: 'Manage portal settings', products: ['algadesk'], defaultGrants: { algadesk: ['msp:Admin'] } },
  { resource: 'settings', action: 'update', msp: true, client: true, description: 'Manage portal settings', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'msp:Admin'] } },
  { resource: 'settings', action: 'update', msp: false, client: true, description: 'Update settings in client portal', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },

  { resource: 'sla_policy', action: 'create', msp: true, client: false, description: 'Create SLA policies', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sla_policy', action: 'delete', msp: true, client: false, description: 'Delete SLA policies', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sla_policy', action: 'read', msp: true, client: false, description: 'View SLA policies', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'sla_policy', action: 'update', msp: true, client: false, description: 'Update SLA policies', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },

  { resource: 'stock_location', action: 'create', msp: true, client: false, description: 'Create stock locations', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_location', action: 'delete', msp: true, client: false, description: 'Delete stock locations', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_location', action: 'read', msp: true, client: false, description: 'View stock locations', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_location', action: 'update', msp: true, client: false, description: 'Update stock locations', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'stock_transfer', action: 'create', msp: true, client: false, description: 'Create stock transfers', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_transfer', action: 'delete', msp: true, client: false, description: 'Delete stock transfers', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_transfer', action: 'read', msp: true, client: false, description: 'View stock transfers', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'stock_transfer', action: 'update', msp: true, client: false, description: 'Update stock transfers', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'storage', action: 'read', msp: true, client: false, description: 'Read storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'storage', action: 'write', msp: true, client: false, description: 'Write storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'system_settings', action: 'create', msp: true, client: false, description: 'Create system settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'system_settings', action: 'delete', msp: true, client: false, description: 'Delete system settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'system_settings', action: 'read', msp: true, client: false, description: 'View system-wide configuration', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'system_settings', action: 'update', msp: true, client: false, description: 'Modify system configuration and defaults', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'tag', action: 'create', msp: true, client: false, description: 'Create new tags for categorization', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'tag', action: 'delete', msp: true, client: false, description: 'Remove tags from the system', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'tag', action: 'read', msp: true, client: false, description: 'View available tags', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'tag', action: 'update', msp: true, client: false, description: 'Edit tags content and colors', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'tax', action: 'read', msp: true, client: false, description: 'View tax rates and tax settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'team', action: 'delete', msp: true, client: false, description: 'Delete teams', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'team', action: 'read', msp: true, client: false, description: 'View teams and their members', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'team', action: 'update', msp: true, client: false, description: 'Update teams and their membership', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'technician_dispatch', action: 'create', msp: true, client: false, description: 'Create dispatch schedules for technicians', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'technician_dispatch', action: 'delete', msp: true, client: false, description: 'Remove dispatch assignments', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'technician_dispatch', action: 'read', msp: true, client: false, description: 'View technician schedules and assignments', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'technician_dispatch', action: 'update', msp: true, client: false, description: 'Modify dispatch assignments and timing', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'ticket', action: 'close_override', msp: true, client: false, description: 'Override ticket close rules', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'ticket', action: 'create', msp: true, client: false, description: 'Create tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'create', msp: false, client: true, description: 'Create tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets from the system', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'ticket', action: 'delete', msp: false, client: true, description: 'Delete tickets', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },
  { resource: 'ticket', action: 'read', msp: true, client: false, description: 'Read tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'read', msp: false, client: true, description: 'Read tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'ticket', action: 'update', msp: true, client: false, description: 'Update tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'update', msp: false, client: true, description: 'Update tickets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },

  { resource: 'ticket_settings', action: 'create', msp: true, client: false, description: 'Create ticket settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'ticket_settings', action: 'delete', msp: true, client: false, description: 'Delete ticket settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'ticket_settings', action: 'read', msp: true, client: false, description: 'View ticket system configuration', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'ticket_settings', action: 'update', msp: true, client: false, description: 'Configure ticket workflows and rules', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'time_entry', action: 'approve', msp: true, client: false, description: 'Approve submitted time entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_entry', action: 'create', msp: true, client: false, description: 'Log time entries for work performed', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_entry', action: 'delete', msp: true, client: false, description: 'Remove time entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'time_entry', action: 'read', msp: true, client: false, description: 'View time entry records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_entry', action: 'update', msp: true, client: false, description: 'Edit time entry details and duration', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  // The v1 timesheet API gates period administration on `time_period`, the same
  // underscored spelling the rest of the system uses; the stored rows spelled it
  // `timeperiod` and nothing translated between them, so these endpoints denied
  // every caller. Renamed onto the canonical name (RENAMED_RESOURCES) with the
  // one action the API added and no tenant ever had.
  { resource: 'time_period', action: 'create', msp: true, client: false, description: 'Create time periods for timesheet cycles', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'delete', msp: true, client: false, description: 'Remove time periods', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'manage', msp: true, client: false, description: 'Manage time period settings and schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'read', msp: true, client: false, description: 'View time periods and their settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'update', msp: true, client: false, description: 'Edit time period dates and settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'time_sheet', action: 'approve', msp: true, client: false, description: 'Approve or reject submitted timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'time_sheet', action: 'create', msp: true, client: false, description: 'Create timesheets for time tracking', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'manage', msp: true, client: false, description: 'Administer timesheets on behalf of other users', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'read', msp: true, client: false, description: 'View timesheet summaries and details', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'read_all', msp: true, client: false, description: 'View all timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'reverse', msp: true, client: false, description: 'Reverse timesheet approvals', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'time_sheet', action: 'submit', msp: true, client: false, description: 'Submit timesheets for approval', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'update', msp: true, client: false, description: 'Modify timesheet entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'user', action: 'create', msp: true, client: false, description: 'Create users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user', action: 'create', msp: false, client: true, description: 'Create client portal users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'] } },
  { resource: 'user', action: 'delete', msp: true, client: false, description: 'Delete users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user', action: 'delete', msp: false, client: true, description: 'Delete client portal users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'] } },
  { resource: 'user', action: 'invite', msp: true, client: false, description: 'Invite users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'user', action: 'read', msp: true, client: false, description: 'Read users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'user', action: 'read', msp: false, client: true, description: 'Read client portal users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin', 'client:Finance'] } },
  { resource: 'user', action: 'reset_password', msp: true, client: false, description: 'Reset password users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user', action: 'reset_password', msp: false, client: true, description: 'Reset password client portal users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'] } },
  { resource: 'user', action: 'update', msp: true, client: false, description: 'Update users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user', action: 'update', msp: false, client: true, description: 'Update client portal users', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'] } },

  { resource: 'user_schedule', action: 'create', msp: true, client: false, description: 'Create user work schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'user_schedule', action: 'delete', msp: true, client: false, description: 'Remove user schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'user_schedule', action: 'read', msp: true, client: false, description: 'View user availability and schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'user_schedule', action: 'update', msp: true, client: false, description: 'Modify user schedule assignments', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'user_settings', action: 'create', msp: true, client: false, description: 'Create user and team settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user_settings', action: 'delete', msp: true, client: false, description: 'Delete user and team settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'user_settings', action: 'read', msp: true, client: false, description: 'Read user and team settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'user_settings', action: 'update', msp: true, client: false, description: 'Update user and team settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'vendor', action: 'create', msp: true, client: false, description: 'Create vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'delete', msp: true, client: false, description: 'Delete vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'read', msp: true, client: false, description: 'View vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'update', msp: true, client: false, description: 'Update vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'vendor_bill', action: 'create', msp: true, client: false, description: 'Create vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'vendor_bill', action: 'read', msp: true, client: false, description: 'View vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'vendor_bill', action: 'update', msp: true, client: false, description: 'Update vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'workflow', action: 'admin', msp: true, client: false, description: 'Administer workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'manage', msp: true, client: false, description: 'Manage workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'publish', msp: true, client: false, description: 'Publish workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'read', msp: true, client: false, description: 'Read workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'view', msp: true, client: false, description: 'View workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
];

function scopeKeys(entry) {
  const keys = [];
  if (entry.msp) keys.push('msp');
  if (entry.client) keys.push('client');
  return keys;
}

/** Stable catalog identity for an entry or a `permissions` row. */
function permissionIdentity(entry) {
  return [
    entry.resource,
    entry.action,
    entry.msp ? 'msp' : '-',
    entry.client ? 'client' : '-',
  ].join('|');
}

/**
 * Every grant key an entry or `permissions` row can be addressed by.
 *
 * A dual-scope permission (msp AND client) yields BOTH keys. The seeds used to
 * derive a single key from `msp ? 'msp' : 'client'`, which silently dropped
 * every client-role grant that pointed at a dual-scope permission.
 */
function permissionGrantKeys(entry) {
  return scopeKeys(entry).map((scope) => `${entry.resource}:${entry.action}:${scope}`);
}

function isProductPermission(entry, product) {
  return entry.products.includes(product);
}

/** Active catalog entries for one product, in catalog order. */
function getProductPermissions(product) {
  if (!PRODUCTS.includes(product)) {
    throw new Error(`Unknown product "${product}"; expected one of ${PRODUCTS.join(', ')}`);
  }
  return ACTIVE_PERMISSIONS.filter((entry) => isProductPermission(entry, product));
}

let cachedVersion = null;

/**
 * Deterministic content hash of the active catalog. Recorded on every sync/audit
 * result so a long-running workflow cannot silently switch definitions midway.
 */
function catalogVersion() {
  if (cachedVersion) return cachedVersion;
  const canonical = ACTIVE_PERMISSIONS.map((entry) => [
    permissionIdentity(entry),
    entry.description,
    entry.products.join(','),
    PRODUCTS.map((product) => `${product}=${((entry.defaultGrants || {})[product] || []).join('+')}`).join(';'),
  ].join('\u0000')).join('\n');
  cachedVersion = `v1-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
  return cachedVersion;
}

module.exports = {
  PRODUCTS,
  ACTIVE_PERMISSIONS,
  RENAMED_RESOURCES,
  canonicalResource,
  catalogVersion,
  getProductPermissions,
  isProductPermission,
  permissionGrantKeys,
  permissionIdentity,
  scopeKeys,
};
