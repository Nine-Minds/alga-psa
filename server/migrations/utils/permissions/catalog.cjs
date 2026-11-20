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
const fs = require('fs');
const path = require('path');

const PRODUCTS = ['algadesk', 'psa', 'co_managed'];

/**
 * Capabilities a product holds by definition. An entry tagged with `capabilities`
 * is provisioned only where every one of them is held: inherently by the product
 * (below) or because the caller names it explicitly. Every other tenant keeps the
 * entry out of its catalog, so a capability-tagged permission is never written by a
 * fleet-wide synchronization to tenants that merely share a product (a plain PSA
 * tenant). Capability admission (e.g. admitCoManagedPermissions) grants it per tenant.
 */
const PRODUCT_CAPABILITIES = { co_managed: ['co-managed'] };

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
  // Co-managed membership below is limited to native helpdesk permissions;
  // commercial permissions are not part of the customer bootstrap catalog.
  { resource: 'co_management', action: 'manage', msp: true, client: false, description: 'Manage co-management provisioning and customer-approved scopes', capabilities: ['co-managed'], products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'co_management', action: 'read', msp: true, client: false, description: 'View co-management relationships and scopes', capabilities: ['co-managed'], products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_attachment', action: 'read', msp: true, client: false, description: 'Read ticket attachments', products: ['co_managed'], defaultGrants: { co_managed: ['msp:Admin', 'msp:Technician', 'msp:Project Manager', 'msp:Dispatcher'] } },
  { resource: 'ticket_attachment', action: 'create', msp: true, client: false, description: 'Upload ticket attachments', products: ['co_managed'], defaultGrants: { co_managed: ['msp:Admin', 'msp:Technician', 'msp:Project Manager', 'msp:Dispatcher'] } },
  { resource: 'ticket_attachment', action: 'read', msp: false, client: true, description: 'Read client ticket attachments', products: ['co_managed'], defaultGrants: { co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'ticket_attachment', action: 'create', msp: false, client: true, description: 'Upload client ticket attachments', products: ['co_managed'], defaultGrants: { co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'knowledge_base', action: 'read', msp: true, client: false, description: 'Read knowledge base articles', products: ['co_managed'], defaultGrants: { co_managed: ['msp:Admin', 'msp:Technician', 'msp:Project Manager', 'msp:Dispatcher'] } },
  { resource: 'knowledge_base', action: 'read', msp: false, client: true, description: 'Read published client knowledge base articles', products: ['co_managed'], defaultGrants: { co_managed: ['client:Admin', 'client:User'] } },
  // CM L4c: a customer portal contact replies on a shared task's requester thread. co_managed only: the
  // psa catalog must never gain it (DO-NOT-PORT #27), so there is deliberately no psa entry.
  { resource: 'project_task_comment', action: 'create', msp: false, client: true, description: 'Reply on shared project task requester threads in client portal', products: ['co_managed'], defaultGrants: { co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'account_management', action: 'delete', msp: true, client: false, description: 'Delete account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'account_management', action: 'read', msp: true, client: false, description: 'Read account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'account_management', action: 'update', msp: true, client: false, description: 'Update account and subscription', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  // Accounting integration capabilities. The old single `billing_settings:update`
  // gate over every accounting integration action is split into five capabilities
  // so each server action and route is gated by the narrowest capability. Admin is
  // the only default role that may touch connections or remote state; Finance gets
  // the read/mapping/export capabilities but no connection administration and no
  // remote destructive operations. Every other default role gets none of these —
  // the accounting integration screens are an Admin/Finance surface.
  { resource: 'accounting_integrations', action: 'catalog_read', msp: true, client: false, description: 'Read remote accounting catalogs and integration status (accounts, items, tax codes, terms, connections)', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'accounting_integrations', action: 'connections_manage', msp: true, client: false, description: 'Save OAuth client credentials, connect and disconnect accounting integrations, and choose the default company', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'accounting_integrations', action: 'exports_execute', msp: true, client: false, description: 'Open Billing > Accounting Exports, and create, run, cancel and download accounting exports', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'accounting_integrations', action: 'mappings_manage', msp: true, client: false, description: 'Create, update, retarget and reconcile accounting mappings', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'accounting_integrations', action: 'remote_mutate', msp: true, client: false, description: 'Perform remote destructive or money-moving operations in connected accounting integrations', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'asset', action: 'create', msp: true, client: false, description: 'Create assets', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'asset', action: 'delete', msp: true, client: false, description: 'Delete assets and maintenance schedules, unlink assets from tickets, and remove documents from assets', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'asset', action: 'read', msp: true, client: false, description: 'View assets, maintenance, custody and audits. Documents linked to an asset are hidden without it.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'asset', action: 'update', msp: true, client: false, description: 'Edit assets, run maintenance, custody and audits, link assets to tickets, upload asset documents, and refresh or run RMM actions', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },

  { resource: 'billing', action: 'create', msp: true, client: false, description: 'Create contracts, quotes, manual invoices, service categories and tax rates, and email invoices to clients', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'create', msp: false, client: true, description: 'Create billing entries in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'billing', action: 'delete', msp: true, client: false, description: 'Delete contracts, quotes, layouts, service categories and tax rates, and reverse recurring invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'read', msp: true, client: false, description: 'View contracts, quotes, invoices, service categories, tax rates and invoice layouts. Also opens the Billing page.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'billing', action: 'read', msp: false, client: true, description: 'See the Billing menu, invoices, quotes, usage and credits in the client portal, and accept or reject quotes', products: ['psa'], defaultGrants: { psa: ['client:Admin', 'client:Finance'] } },
  { resource: 'billing', action: 'update', msp: true, client: false, description: 'Edit contracts, contract lines, quotes, invoice layouts, service categories and tax settings, and send quotes', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing', action: 'update', msp: false, client: true, description: 'Update billing entries in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },

  { resource: 'billing.recurring_service_periods', action: 'correct_history', msp: true, client: false, description: 'Correct the billed history of recurring service periods', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'billing.recurring_service_periods', action: 'regenerate', msp: true, client: false, description: 'Preview and repair recurring service periods on the Billing > Service Periods tab', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'billing.recurring_service_periods', action: 'view', msp: true, client: false, description: 'View recurring service periods on the Billing > Service Periods tab', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },

  { resource: 'billing_profile_report', action: 'read', msp: true, client: false, description: 'View spend broken down by billing profile', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager'] } },

  { resource: 'billing_settings', action: 'create', msp: true, client: false, description: 'Create billing configuration profiles', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing_settings', action: 'delete', msp: true, client: false, description: 'Remove billing configuration profiles', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'billing_settings', action: 'read', msp: true, client: false, description: 'View billing settings: currency, payment terms, credit, renewal and quote defaults', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'billing_settings', action: 'update', msp: true, client: false, description: 'Change billing settings, and a client\'s zero-dollar, credit and prepaid alert settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'canned_response', action: 'create', msp: true, client: false, description: 'Create canned ticket responses', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'canned_response', action: 'delete', msp: true, client: false, description: 'Delete canned ticket responses', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'canned_response', action: 'read', msp: true, client: false, description: 'View canned ticket responses and insert them into comments', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'canned_response', action: 'update', msp: true, client: false, description: 'Modify canned ticket responses', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Technician'] } },

  { resource: 'client', action: 'create', msp: true, client: false, description: 'Add clients, import clients, and assign contracts to clients', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'client', action: 'create', msp: false, client: true, description: 'Create client information', products: ['psa', 'co_managed'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'client', action: 'delete', msp: true, client: false, description: 'Delete clients', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin'] } },
  { resource: 'client', action: 'delete', msp: false, client: true, description: 'Delete client information', products: ['psa', 'co_managed'], defaultGrants: { psa: ['client:Admin'], co_managed: ['client:Admin'] } },
  { resource: 'client', action: 'read', msp: true, client: false, description: 'View clients and pick clients on tickets, projects, contracts, quotes and time entries. Opening a client also needs Contact > Read.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'client', action: 'read', msp: false, client: true, description: 'See Company Settings and your company\'s details in the client portal', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'client', action: 'update', msp: true, client: false, description: 'Edit clients, their locations and notes, and their billing settings, billing profiles, contracts and tax rate. Also activates and terminates contracts.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'client', action: 'update', msp: false, client: true, description: 'Edit your company\'s details and logo in the client portal', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },

  { resource: 'contact', action: 'create', msp: true, client: false, description: 'Add contacts and import contacts', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'contact', action: 'delete', msp: true, client: false, description: 'Delete contacts', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin'] } },
  { resource: 'contact', action: 'read', msp: true, client: false, description: 'View contacts and pick contacts on tickets, quotes and projects. Required to open a client.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'contact', action: 'read', msp: false, client: true, description: 'Read contacts', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin', 'client:User'] } },
  { resource: 'contact', action: 'update', msp: true, client: false, description: 'Edit and deactivate contacts, and manage a contact\'s client portal visibility groups', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'contact', action: 'update', msp: false, client: true, description: 'Update contacts', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },

  { resource: 'credential', action: 'audit', msp: true, client: false, description: 'View the Passwords audit log. Also needs Credential > Read.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Manager'] } },
  { resource: 'credential', action: 'create', msp: true, client: false, description: 'Create credentials in the vault', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'credential', action: 'delete', msp: true, client: false, description: 'Delete credentials from the vault', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'credential', action: 'read', msp: true, client: false, description: 'View the Passwords list and password details, without revealing values', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'credential', action: 'reveal', msp: true, client: false, description: 'Reveal the plaintext value of a credential', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'credential', action: 'update', msp: true, client: false, description: 'Edit and restrict passwords, and attach them to assets, tickets and contacts', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Technician'] } },

  { resource: 'credit', action: 'create', msp: true, client: false, description: 'Add credits and create prepayment invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'delete', msp: true, client: false, description: 'Remove credit records', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'read', msp: true, client: false, description: 'View credits and their history', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'transfer', msp: true, client: false, description: 'Transfer credits between clients', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'credit', action: 'update', msp: true, client: false, description: 'Change credit expiration, expire credits, and apply credit to invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'cycle_count', action: 'approve', msp: true, client: false, description: 'Approve cycle counts and post the resulting stock adjustments', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'create', msp: true, client: false, description: 'Start inventory cycle count sessions', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'read', msp: true, client: false, description: 'View cycle count sessions and their variances', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'cycle_count', action: 'update', msp: true, client: false, description: 'Record counts on an open cycle count session', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'document', action: 'create', msp: true, client: false, description: 'Upload documents, create folders, attach files to tickets, and create knowledge base articles', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'create', msp: false, client: true, description: 'Upload attachments to tickets in the client portal', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents, folders and knowledge base articles', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Finance'] } },
  // Governs the tenant's allowed download hosts for URL document sources. `document:create` does NOT imply it.
  { resource: 'document', action: 'manage_fetch_hosts', msp: true, client: false, description: 'Manage allowed download hosts for document URL downloads', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'document', action: 'read', msp: true, client: false, description: 'View documents and folders, download files, and read knowledge base articles', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'read', msp: false, client: true, description: 'See the Documents menu and the knowledge base in the client portal', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },
  { resource: 'document', action: 'update', msp: true, client: false, description: 'Edit, move and share documents, link documents to records, and edit or publish knowledge base articles', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'document', action: 'update', msp: false, client: true, description: 'Update documents', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'] } },

  { resource: 'email', action: 'process', msp: true, client: false, description: 'Process outbound email', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'extension', action: 'read', msp: true, client: false, description: 'Read extension APIs and storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'extension', action: 'write', msp: true, client: false, description: 'Write extension APIs and storage', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'financial', action: 'create', msp: true, client: false, description: 'REST API only: create financial records. Has no effect in the app.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'delete', msp: true, client: false, description: 'REST API only: delete financial records. Has no effect in the app.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'read', msp: true, client: false, description: 'REST API only: view financial records. Has no effect in the app.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'transfer', msp: true, client: false, description: 'REST API only: transfer credits. Has no effect in the app.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'financial', action: 'update', msp: true, client: false, description: 'REST API only: update financial records. Has no effect in the app.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'import_export', action: 'manage', msp: true, client: false, description: 'Create and execute asset imports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'import_export', action: 'read', msp: true, client: false, description: 'View asset import/export settings and history', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'inbound_webhook', action: 'create', msp: true, client: false, description: 'Create inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'delete', msp: true, client: false, description: 'Delete inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'read', msp: true, client: false, description: 'View inbound webhooks and deliveries', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'replay', msp: true, client: false, description: 'Replay inbound webhook deliveries', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inbound_webhook', action: 'update', msp: true, client: false, description: 'Update inbound webhooks', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'interaction', action: 'create', msp: true, client: false, description: 'Create interactions (calls, notes, check-ins, activity)', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'interaction', action: 'delete', msp: true, client: false, description: 'Delete interactions', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'], co_managed: ['msp:Admin'] } },
  { resource: 'interaction', action: 'read', msp: true, client: false, description: 'View interactions', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'interaction', action: 'update', msp: true, client: false, description: 'Update interactions', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'inventory', action: 'create', msp: true, client: false, description: 'Receive stock, create kits and returns, and create purchase orders from low stock', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'delete', msp: true, client: false, description: 'Delete inventory records', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'read', msp: true, client: false, description: 'View the inventory dashboard, stock, units, kits, loaners and returns, and pick stock as materials on tickets and projects', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'inventory', action: 'update', msp: true, client: false, description: 'Adjust and retire stock, manage loaners, kit components and returns', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'invoice', action: 'create', msp: true, client: false, description: 'Preview and generate invoices, and approve project billing. Configuring project billing also uses this.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'credit', msp: true, client: false, description: 'REST API only. In the app, applying credit needs Credit > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete draft invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'finalize', msp: true, client: false, description: 'REST API only. In the app, finalizing needs Invoice > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'generate', msp: true, client: false, description: 'Preview and generate invoices, and approve project billing. Same effect as Invoice > Create.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'payment', msp: true, client: false, description: 'Record payments against invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'read', msp: true, client: false, description: 'Download single invoice PDFs and view invoice history. Invoice lists need Billing > Read.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'invoice', action: 'send', msp: true, client: false, description: 'REST API only. In the app, emailing invoices needs Billing > Create.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'update', msp: true, client: false, description: 'Edit draft invoices, and finalize or unfinalize invoices', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'invoice', action: 'void', msp: true, client: false, description: 'Void invoices. With QuickBooks Online connected, also needs Accounting Integrations > Remote Mutate.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },

  { resource: 'job', action: 'delete', msp: true, client: false, description: 'Clear job monitoring history', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  // Named list views. Owners always manage their own views; these gate
  // publishing to everyone and administering other users' shared views.
  { resource: 'list_view', action: 'manage', msp: true, client: false, description: "Edit or delete other users' shared list views", products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'list_view', action: 'share', msp: true, client: false, description: 'Publish list views shared with every user of the list', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'marketing', action: 'manage', msp: true, client: false, description: 'Manage marketing campaigns, content, posts, sequences, and forms', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'marketing', action: 'read', msp: true, client: false, description: 'View marketing campaigns, content, posts, and sequences', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'metadata', action: 'read', msp: true, client: false, description: 'Read the API metadata: the OpenAPI document, endpoint catalog, schemas and API statistics', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'notification', action: 'manage', msp: true, client: false, description: 'Manage notifications', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'notification', action: 'read', msp: true, client: false, description: 'Read notifications', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'opportunities', action: 'create', msp: true, client: false, description: 'Create opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'delete', msp: true, client: false, description: 'Delete opportunities', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'read', msp: true, client: false, description: 'View opportunities, including a client\'s Opportunities tab', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'opportunities', action: 'update', msp: true, client: false, description: 'Edit opportunities, move stages, add steps, link quotes, and mark them won or lost', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'priority', action: 'create', msp: true, client: false, description: 'Create ticket priorities', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'project', action: 'create', msp: true, client: false, description: 'Create projects and project templates, create a project from a template, and duplicate tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project', action: 'create', msp: false, client: true, description: 'Create projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'project', action: 'delete', msp: true, client: false, description: 'Delete projects, phases, templates, tasks and checklist items', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project', action: 'delete', msp: false, client: true, description: 'Delete projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
  { resource: 'project', action: 'read', msp: true, client: false, description: 'View projects, phases and tasks, and export tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project', action: 'read', msp: false, client: true, description: 'See the Projects menu and your company\'s projects in the client portal', products: ['psa', 'co_managed'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'project', action: 'update', msp: true, client: false, description: 'Edit projects, phases and templates, and create, edit, move and assign tasks. Task work needs this permission, not Project Task.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager'] } },
  { resource: 'project', action: 'update', msp: false, client: true, description: 'Update projects in client portal', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },

  { resource: 'project_task', action: 'create', msp: true, client: false, description: 'Add comments to project tasks. Creating tasks needs Project > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project_task', action: 'delete', msp: true, client: false, description: 'Delete comments on project tasks, including your own. Deleting tasks needs Project > Delete.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'project_task', action: 'read', msp: true, client: false, description: 'Read comments on project tasks', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'project_task', action: 'update', msp: true, client: false, description: 'Edit comments and tags on a single project task. Editing tasks needs Project > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'purchase_order', action: 'create', msp: true, client: false, description: 'Create purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'delete', msp: true, client: false, description: 'Delete purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'read', msp: true, client: false, description: 'View purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'purchase_order', action: 'update', msp: true, client: false, description: 'Edit and receive purchase orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'quotes', action: 'approve', msp: true, client: false, description: 'Approve quotes or request changes when quote approval is on. Creating and editing quotes needs Billing permissions.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'recurring_ticket', action: 'create', msp: true, client: false, description: 'Create recurring ticket definitions', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'recurring_ticket', action: 'delete', msp: true, client: false, description: 'Archive recurring ticket definitions', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'recurring_ticket', action: 'read', msp: true, client: false, description: 'View recurring ticket definitions and run history', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Technician'] } },
  { resource: 'recurring_ticket', action: 'update', msp: true, client: false, description: 'Modify recurring ticket definitions, clients and schedules', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'reports', action: 'create', msp: true, client: false, description: 'Create reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'reports', action: 'delete', msp: true, client: false, description: 'Delete reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'reports', action: 'read', msp: true, client: false, description: 'Read reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'reports', action: 'update', msp: true, client: false, description: 'Update reports', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'rmm', action: 'execute_command', msp: true, client: false, description: 'Reboot, run scripts and open remote control on Datto RMM devices. Also needs Asset > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'role', action: 'create', msp: true, client: false, description: 'REST API only. In the app, creating roles needs Security Settings > Create.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'role', action: 'delete', msp: true, client: false, description: 'REST API only. In the app, deleting roles needs Security Settings > Delete.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'role', action: 'read', msp: true, client: false, description: 'REST API only. Anyone can view roles in the app.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'role', action: 'update', msp: true, client: false, description: 'REST API only. In the app, changing roles needs Security Settings > Update.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'sales_order', action: 'create', msp: true, client: false, description: 'Create sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'delete', msp: true, client: false, description: 'Delete sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'read', msp: true, client: false, description: 'View sales orders', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'sales_order', action: 'update', msp: true, client: false, description: 'Edit and fulfill sales orders. Invoicing a sales order also needs Billing > Create.', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'secrets', action: 'manage', msp: true, client: false, description: 'Create, update, and delete secrets', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'secrets', action: 'view', msp: true, client: false, description: 'View secret names and metadata (not values)', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'security_settings', action: 'create', msp: true, client: false, description: 'Create roles', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'delete', msp: true, client: false, description: 'Delete roles', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'read', msp: true, client: false, description: 'View every user\'s active sessions', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'security_settings', action: 'update', msp: true, client: false, description: 'Rename roles, change role permissions, and end other users\' sessions', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services and products in the service catalog, and add custom units of measure', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'service', action: 'delete', msp: true, client: false, description: 'Delete services and products, and delete service types', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'service', action: 'read', msp: true, client: false, description: 'View the service catalog and products, and pick services on quotes and projects. Also opens the Billing page.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'service', action: 'update', msp: true, client: false, description: 'Edit services and products, change prices and see costs. Changing a rate also needs Billing > Read.', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'settings', action: 'create', msp: true, client: true, description: 'Create portal settings', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'settings', action: 'delete', msp: true, client: true, description: 'Needed, with User Settings > Delete, to delete a team', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: true, client: false, description: 'View notification settings, email templates, sender addresses and client portal domain settings', products: ['algadesk'], defaultGrants: { algadesk: ['msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: true, client: true, description: 'View notification settings, email templates, sender addresses and client portal domain settings', products: ['psa', 'co_managed'], defaultGrants: { psa: ['client:Admin', 'client:Finance', 'msp:Admin'], co_managed: ['client:Admin', 'msp:Admin'] } },
  { resource: 'settings', action: 'read', msp: false, client: true, description: 'View settings in client portal', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },
  { resource: 'settings', action: 'update', msp: true, client: false, description: 'Change notifications, email templates and branding, sender addresses, ticket numbering, client portal logo, domain and features, SSO login policy, and interaction types', products: ['algadesk'], defaultGrants: { algadesk: ['msp:Admin'] } },
  { resource: 'settings', action: 'update', msp: true, client: true, description: 'Change notifications, email templates and branding, sender addresses, ticket numbering, client portal logo, domain and features, SSO login policy, and interaction types', products: ['psa', 'co_managed'], defaultGrants: { psa: ['client:Admin', 'msp:Admin'], co_managed: ['client:Admin', 'msp:Admin'] } },
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
  { resource: 'system_settings', action: 'read', msp: true, client: false, description: 'View integrations (RMM, Entra, Microsoft, Google, Teams, Hudu) and Policies', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'system_settings', action: 'update', msp: true, client: false, description: 'Change integrations (RMM, Entra, Microsoft, Google, Teams, Hudu), SSO identity providers and login domains, Policies, and asset types and statuses', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'tag', action: 'create', msp: true, client: false, description: 'Create new tags for categorization', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'tag', action: 'delete', msp: true, client: false, description: 'Remove tags from the system', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'tag', action: 'read', msp: true, client: false, description: 'View available tags', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'tag', action: 'update', msp: true, client: false, description: 'Edit tags content and colors', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'tax', action: 'read', msp: true, client: false, description: 'Not used. Tax screens use Billing permissions.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'team', action: 'delete', msp: true, client: false, description: 'Delete teams', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'team', action: 'read', msp: true, client: false, description: 'View teams and their members', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'team', action: 'update', msp: true, client: false, description: 'Update teams and their membership', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'technician_dispatch', action: 'create', msp: true, client: false, description: 'Create dispatch schedules for technicians', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'technician_dispatch', action: 'delete', msp: true, client: false, description: 'Remove dispatch assignments', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'technician_dispatch', action: 'read', msp: true, client: false, description: 'Open the Technician Dispatch board. Technician rows also need User > Read.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'technician_dispatch', action: 'update', msp: true, client: false, description: 'Edit on the Technician Dispatch board. Assigning work to other technicians also needs User Schedule > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'ticket', action: 'close_override', msp: true, client: false, description: 'Close a ticket that does not meet its board\'s close rules', products: ['psa', 'co_managed'], defaultGrants: { psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket', action: 'create', msp: true, client: false, description: 'Create, duplicate and import tickets', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'create', msp: false, client: true, description: 'Create tickets in the client portal', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket', action: 'delete', msp: false, client: true, description: 'Delete your own ticket comments in the client portal', products: ['algadesk'], defaultGrants: { algadesk: ['client:Admin'] } },
  { resource: 'ticket', action: 'read', msp: true, client: false, description: 'View tickets, their comments, checklists and materials, and export the ticket list', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'read', msp: false, client: true, description: 'See tickets in the client portal', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },
  { resource: 'ticket', action: 'update', msp: true, client: false, description: 'Edit tickets, comment, close, assign, bulk update, and edit close rules and external systems', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket', action: 'update', msp: false, client: true, description: 'Reply to tickets and change their status in the client portal', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin', 'client:User'], psa: ['client:Admin', 'client:Finance', 'client:User'], co_managed: ['client:Admin', 'client:User'] } },

  { resource: 'ticket_settings', action: 'create', msp: true, client: false, description: 'Create boards', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_settings', action: 'delete', msp: true, client: false, description: 'Delete boards', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_settings', action: 'read', msp: true, client: false, description: 'View email providers, checklist templates and board notification settings', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Technician'] } },
  { resource: 'ticket_settings', action: 'update', msp: true, client: false, description: 'Edit boards, board statuses, ticket display settings, checklist templates, outbound email settings and email providers', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_template', action: 'create', msp: true, client: false, description: 'Create ticket templates', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_template', action: 'delete', msp: true, client: false, description: 'Delete ticket templates', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'ticket_template', action: 'read', msp: true, client: false, description: 'View ticket templates and start tickets from them', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'ticket_template', action: 'update', msp: true, client: false, description: 'Modify ticket templates', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'time_entry', action: 'approve', msp: true, client: false, description: 'Not used. Timesheet approval is controlled by Time Sheet > Approve.', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_entry', action: 'create', msp: true, client: false, description: 'Log time and add work items to a timesheet. Logging time on a ticket or project task also needs Client > Read.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_entry', action: 'delete', msp: true, client: false, description: 'Delete time entries and remove work item rows, including your own', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance'] } },
  { resource: 'time_entry', action: 'read', msp: true, client: false, description: 'View time entries. Required to open a timesheet and the time entry form.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_entry', action: 'update', msp: true, client: false, description: 'Edit time entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  // The v1 timesheet API gates period administration on `time_period`, the same
  // underscored spelling the rest of the system uses; the stored rows spelled it
  // `timeperiod` and nothing translated between them, so these endpoints denied
  // every caller. Renamed onto the canonical name (RENAMED_RESOURCES) with the
  // one action the API added and no tenant ever had.
  { resource: 'time_period', action: 'create', msp: true, client: false, description: 'Create and generate time periods', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'delete', msp: true, client: false, description: 'Delete time periods', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'manage', msp: true, client: false, description: 'Change the time period cadence settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'read', msp: true, client: false, description: 'View time periods and time period settings', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_period', action: 'update', msp: true, client: false, description: 'Edit time period dates', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'time_sheet', action: 'approve', msp: true, client: false, description: 'Approve timesheets and request changes for people you manage. The Approvals page also requires managing a team and User Settings > Read.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'time_sheet', action: 'create', msp: true, client: false, description: 'Create timesheets for time tracking', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'manage', msp: true, client: false, description: 'Administer timesheets on behalf of other users', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'time_sheet', action: 'read', msp: true, client: false, description: 'Open timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'read_all', msp: true, client: false, description: 'Together with Time Sheet > Approve, see and approve every user\'s timesheet, not only those of people you manage', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'reverse', msp: true, client: false, description: 'Reopen approved timesheets', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager'] } },
  { resource: 'time_sheet', action: 'submit', msp: true, client: false, description: 'Submit your timesheet for approval', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'time_sheet', action: 'update', msp: true, client: false, description: 'Modify timesheet entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },

  { resource: 'user', action: 'create', msp: true, client: false, description: 'Create users with a password', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user', action: 'create', msp: false, client: true, description: 'Add client portal users. Also requires the portal Admin role.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'], co_managed: ['client:Admin'] } },
  { resource: 'user', action: 'delete', msp: true, client: false, description: 'Delete users', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user', action: 'delete', msp: false, client: true, description: 'Delete client portal users. Also requires the portal Admin role.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'], co_managed: ['client:Admin'] } },
  { resource: 'user', action: 'invite', msp: true, client: false, description: 'Invite users by email and revoke invitations', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Project Manager'] } },
  { resource: 'user', action: 'read', msp: true, client: false, description: 'See the list of users. Assignee pickers on tickets and projects, team member pickers, the dispatch board and the Users tab need it.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager'] } },
  { resource: 'user', action: 'read', msp: false, client: true, description: 'See the User Management tab and the list of client portal users', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin', 'client:Finance'], co_managed: ['client:Admin'] } },
  { resource: 'user', action: 'reset_password', msp: true, client: false, description: 'Not used in the app. Resetting another user\'s password requires the role named Admin.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user', action: 'reset_password', msp: false, client: true, description: 'Reset client portal user passwords. Also requires the portal Admin role.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'], co_managed: ['client:Admin'] } },
  { resource: 'user', action: 'update', msp: true, client: false, description: 'Edit, deactivate and reactivate users, and assign or remove roles', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user', action: 'update', msp: false, client: true, description: 'Edit and deactivate client portal users and assign their roles. Also requires the portal Admin role.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['client:Admin'], psa: ['client:Admin'], co_managed: ['client:Admin'] } },

  { resource: 'user_schedule', action: 'create', msp: true, client: false, description: 'Create user work schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },
  { resource: 'user_schedule', action: 'delete', msp: true, client: false, description: 'Remove user schedules', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'user_schedule', action: 'read', msp: true, client: false, description: 'View your own calendar and calendars shared with you, and create, edit or delete your own schedule entries', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Finance', 'msp:Manager', 'msp:Project Manager', 'msp:Technician'] } },
  { resource: 'user_schedule', action: 'update', msp: true, client: false, description: 'View every calendar and create, edit or delete schedule entries for any user, including assigning work on the dispatch board. Also shows other users\' activities.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Dispatcher'] } },

  { resource: 'user_settings', action: 'create', msp: true, client: false, description: 'Create teams', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user_settings', action: 'delete', msp: true, client: false, description: 'Delete teams. Also needs Settings > Delete.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },
  { resource: 'user_settings', action: 'read', msp: true, client: false, description: 'View teams. Needed for every team picker, including tickets and projects, and to open the timesheet Approvals page.', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin', 'msp:Agent'], psa: ['msp:Admin', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager'], co_managed: ['msp:Admin', 'msp:Dispatcher', 'msp:Project Manager'] } },
  { resource: 'user_settings', action: 'update', msp: true, client: false, description: 'Rename teams and change their members or manager', products: ['algadesk', 'psa', 'co_managed'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } },

  { resource: 'vendor', action: 'create', msp: true, client: false, description: 'Create vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'delete', msp: true, client: false, description: 'Delete vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'read', msp: true, client: false, description: 'View vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'vendor', action: 'update', msp: true, client: false, description: 'Update vendors', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },

  { resource: 'vendor_bill', action: 'create', msp: true, client: false, description: 'Create vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'vendor_bill', action: 'read', msp: true, client: false, description: 'View vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'vendor_bill', action: 'update', msp: true, client: false, description: 'Update vendor bills', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'warranty', action: 'create', msp: true, client: false, description: 'Open warranty claims on client equipment. Also needs Asset > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'warranty', action: 'read', msp: true, client: false, description: 'View warranty claims and RMA cases', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },
  { resource: 'warranty', action: 'update', msp: true, client: false, description: 'Decide, ship, receive and close warranty claims. Also needs Asset > Update.', products: ['psa'], defaultGrants: { psa: ['msp:Admin', 'msp:Manager', 'msp:Technician'] } },

  { resource: 'webhook', action: 'analytics', msp: true, client: false, description: 'View webhook delivery analytics and statistics', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'bulk_update', msp: true, client: false, description: 'Enable, disable or delete several webhooks in one request', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'create', msp: true, client: false, description: 'Create webhooks and webhook templates', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'delete', msp: true, client: false, description: 'Delete webhooks and stop their event deliveries', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'export', msp: true, client: false, description: 'Export webhook configuration and delivery history', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'manage_security', msp: true, client: false, description: 'Manage webhook signing secrets and security settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'manage_subscriptions', msp: true, client: false, description: 'Manage which events a webhook subscribes to', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'read', msp: true, client: false, description: 'View webhooks, their delivery history and test results. The Webhooks tab in Settings > Security requires the role named Admin instead.', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'retry', msp: true, client: false, description: 'Retry failed webhook deliveries', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'system_settings', msp: true, client: false, description: 'View and manage system-wide webhook settings', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'test', msp: true, client: false, description: 'Send test deliveries and test webhook endpoints', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'trigger', msp: true, client: false, description: 'Manually trigger webhook events', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'update', msp: true, client: false, description: 'Modify webhook configuration', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },
  { resource: 'webhook', action: 'verify', msp: true, client: false, description: 'Verify webhook signatures and endpoint ownership', products: ['algadesk', 'psa'], defaultGrants: { algadesk: ['msp:Admin'], psa: ['msp:Admin'] } },

  { resource: 'workflow', action: 'admin', msp: true, client: false, description: 'Administer workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'manage', msp: true, client: false, description: 'Manage workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'publish', msp: true, client: false, description: 'Publish workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'read', msp: true, client: false, description: 'Read workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
  { resource: 'workflow', action: 'view', msp: true, client: false, description: 'View workflows', products: ['psa'], defaultGrants: { psa: ['msp:Admin'] } },
];

/**
 * Edition contributions.
 *
 * Features that exist in only one edition contribute their permission entries
 * from a directory of `*.cjs` modules (each exporting an array of entries in the
 * shape above) instead of a literal in this file. Two layouts are searched: the
 * source checkout (`ee/server/permission-catalog`) and the packaged Temporal
 * worker image (`./contributions`, copied by ee/temporal-workflows/Dockerfile).
 * A directory that does not exist contributes nothing, so a CE checkout is
 * unchanged. Contributions join ACTIVE_PERMISSIONS before anything reads it, so
 * onboarding, seeds, reconciliation and `catalogVersion` all see them.
 */
const CONTRIBUTION_DIRECTORIES = [
  path.resolve(__dirname, '../../../../ee/server/permission-catalog'),
  path.resolve(__dirname, 'contributions'),
];

function loadContributions(directories = CONTRIBUTION_DIRECTORIES) {
  const loaded = [];
  const seen = new Set();
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.cjs')).sort()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const entries = require(path.join(directory, file));
      if (!Array.isArray(entries)) {
        throw new Error(`Permission catalog contribution ${file} must export an array of entries`);
      }
      loaded.push(...entries);
    }
  }
  return loaded;
}

ACTIVE_PERMISSIONS.push(...loadContributions());

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

/**
 * Whether a product-member entry is provisionable given the capabilities held.
 * An untagged entry always is; a tagged one needs every capability, either
 * inherent to the product or passed in by a capability-aware caller.
 */
function isEntryAvailable(entry, product, capabilities = []) {
  if (!entry.capabilities || entry.capabilities.length === 0) return true;
  const held = new Set([...(PRODUCT_CAPABILITIES[product] || []), ...capabilities]);
  return entry.capabilities.every((capability) => held.has(capability));
}

/**
 * Active catalog entries for one product, in catalog order, without any entry
 * gated on a capability the product does not inherently hold (see PRODUCT_CAPABILITIES).
 * Pass `capabilities` to include entries for tenants admitted to those capabilities.
 */
function getProductPermissions(product, { capabilities = [] } = {}) {
  if (!PRODUCTS.includes(product)) {
    throw new Error(`Unknown product "${product}"; expected one of ${PRODUCTS.join(', ')}`);
  }
  return ACTIVE_PERMISSIONS.filter((entry) => isProductPermission(entry, product)
    && isEntryAvailable(entry, product, capabilities));
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
    (entry.capabilities || []).join(','),
    PRODUCTS.map((product) => `${product}=${((entry.defaultGrants || {})[product] || []).join('+')}`).join(';'),
  ].join('\u0000')).join('\n');
  cachedVersion = `v1-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
  return cachedVersion;
}

module.exports = {
  PRODUCTS,
  PRODUCT_CAPABILITIES,
  ACTIVE_PERMISSIONS,
  RENAMED_RESOURCES,
  canonicalResource,
  catalogVersion,
  loadContributions,
  getProductPermissions,
  isEntryAvailable,
  isProductPermission,
  permissionGrantKeys,
  permissionIdentity,
  scopeKeys,
};
