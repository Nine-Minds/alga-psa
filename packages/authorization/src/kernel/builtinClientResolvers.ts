import { clientPath, type ClientPath, type DiscriminatorClientResolver } from './clientPath';

// ---------------------------------------------------------------------------
// The built-in client resolvers, one per polymorphic family in the tenant table
// manifest (`clientKeyed: { by: 'resolver', resolver: '<name>' }`).
//
// They live in the authorization package, not in the packages that own the kinds:
// tickets, projects and documents all import authorization, so owning the
// definitions there would be a package cycle. They are plain table/column paths,
// so the kernel needs nothing from those packages. A package that adds a kind
// (e.g. a contributed work-item type) registers it on `clientResolvers`.
//
// Only kinds with a real client path are listed. A value that is not listed has
// no client: the row facet gives null and the SQL facet matches nothing.
//   work_item      : not listed - ad_hoc, non_billable_category (no parent record),
//                    co_managed (a contributed type whose work item is not a local table).
//   tagged_entity  : not listed - workflow_form, knowledge_base_article, document.
//   document_entity: not listed - user, team, tenant, document. The table's CHECK constraint
//                    (document_associations_entity_type_check) lists the legal values; every one
//                    of them is either mapped here or named in this comment as client-less.
// ---------------------------------------------------------------------------

const clientColumn = 'client_id';

const projectPhaseHop = { column: 'phase_id', table: 'project_phases', parentColumn: 'phase_id' } as const;
const phaseProjectHop = { column: 'project_id', table: 'projects', parentColumn: 'project_id' } as const;

const ownedBy = {
  client: { table: 'clients', idColumn: 'client_id', clientColumn },
  contact: { table: 'contacts', idColumn: 'contact_name_id', clientColumn },
  ticket: { table: 'tickets', idColumn: 'ticket_id', clientColumn },
  project: { table: 'projects', idColumn: 'project_id', clientColumn },
  projectTask: {
    table: 'project_tasks',
    idColumn: 'task_id',
    via: [projectPhaseHop, phaseProjectHop],
    clientColumn,
  },
  interaction: { table: 'interactions', idColumn: 'interaction_id', clientColumn },
  // appointment_requests.client_id carries no foreign key; the manifest says so (`enforced: false`).
  appointmentRequest: { table: 'appointment_requests', idColumn: 'appointment_request_id', clientColumn },
  opportunity: { table: 'opportunities', idColumn: 'opportunity_id', clientColumn },
  opportunityStep: {
    table: 'opportunity_steps',
    idColumn: 'step_id',
    via: [{ column: 'opportunity_id', table: 'opportunities', parentColumn: 'opportunity_id' }],
    clientColumn,
  },
  asset: { table: 'assets', idColumn: 'asset_id', clientColumn },
  contract: { table: 'contracts', idColumn: 'contract_id', clientColumn: 'owner_client_id' },
  invoice: { table: 'invoices', idColumn: 'invoice_id', clientColumn },
  quote: { table: 'quotes', idColumn: 'quote_id', clientColumn },
  salesOrder: { table: 'sales_orders', idColumn: 'so_id', clientColumn },
} satisfies Record<string, ClientPath>;

type Entries = Record<string, DiscriminatorClientResolver>;

const entries = (paths: Record<string, ClientPath>): Entries =>
  Object.fromEntries(Object.entries(paths).map(([kind, path]) => [kind, clientPath(path)]));

export const BUILTIN_CLIENT_RESOLVERS: Readonly<Record<string, Entries>> = {
  // time_entries.work_item_type, schedule_entries.work_item_type
  work_item: entries({
    ticket: ownedBy.ticket,
    project_task: ownedBy.projectTask,
    interaction: ownedBy.interaction,
    appointment_request: ownedBy.appointmentRequest,
    opportunity_step: ownedBy.opportunityStep,
  }),
  // tag_mappings.tagged_type (TaggedEntityType)
  tagged_entity: entries({
    client: ownedBy.client,
    contact: ownedBy.contact,
    ticket: ownedBy.ticket,
    project: ownedBy.project,
    project_task: ownedBy.projectTask,
    interaction: ownedBy.interaction,
    opportunity: ownedBy.opportunity,
  }),
  // document_associations.entity_type
  document_entity: entries({
    client: ownedBy.client,
    contact: ownedBy.contact,
    ticket: ownedBy.ticket,
    asset: ownedBy.asset,
    contract: ownedBy.contract,
    invoice: ownedBy.invoice,
    quote: ownedBy.quote,
    sales_order: ownedBy.salesOrder,
    interaction: ownedBy.interaction,
    project_task: ownedBy.projectTask,
    opportunity: ownedBy.opportunity,
  }),
};
