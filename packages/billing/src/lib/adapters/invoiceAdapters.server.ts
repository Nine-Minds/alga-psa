import { tenantDb } from '@alga-psa/db';
import type {
  WasmInvoiceLineItemLocation,
  WasmInvoiceViewModel,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import { buildInvoiceLocationGroups } from './invoiceAdapters';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const buildLocationAddressBlock = (location: WasmInvoiceLineItemLocation | null): string | null => {
  if (!location) return null;
  const lines: string[] = [];
  for (const field of [location.address_line1, location.address_line2, location.address_line3]) {
    const trimmed = asTrimmedString(field);
    if (trimmed) lines.push(trimmed);
  }
  const cityLine = [location.city, location.state_province, location.postal_code]
    .map(asTrimmedString)
    .filter((value) => value.length > 0)
    .join(', ');
  if (cityLine) lines.push(cityLine);
  const country = asTrimmedString(location.country_name) || asTrimmedString(location.country_code);
  if (country) lines.push(country);
  return lines.length > 0 ? lines.join('\n') : null;
};

async function enrichInvoiceViewModelWithProjects(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  viewModel: WasmInvoiceViewModel,
): Promise<void> {
  const invoiceId = (viewModel as WasmInvoiceViewModel & {
    __invoiceId?: string | null;
  }).__invoiceId;
  if (!invoiceId) return;

  try {
    const db = tenantDb(knexOrTrx, tenant);
    const invoiceProjectQuery = db.table('invoices as invoice');
    db.tenantJoin(
      invoiceProjectQuery,
      'projects as project',
      'invoice.project_id',
      'project.project_id',
      { type: 'left' },
    );
    const invoiceProject = await invoiceProjectQuery
      .where('invoice.invoice_id', invoiceId)
      .first(
        'invoice.project_id',
        'project.project_name',
        'project.project_number',
      );

    const scheduleLinesQuery = db.table('project_billing_schedule_entries as entry');
    db.tenantJoin(scheduleLinesQuery, 'project_billing_configs as config', 'entry.config_id', 'config.config_id');
    db.tenantJoin(scheduleLinesQuery, 'projects as project', 'config.project_id', 'project.project_id');
    db.tenantJoin(scheduleLinesQuery, 'project_phases as phase', 'entry.phase_id', 'phase.phase_id', { type: 'left' });
    const scheduleLines = await scheduleLinesQuery
      .where('entry.invoice_id', invoiceId)
      .whereNotNull('entry.invoice_charge_id')
      .select(
        'entry.invoice_charge_id as item_id',
        'project.project_name',
        'project.project_number',
        'phase.phase_name',
      );

    const timeLinesQuery = db.table('invoice_time_entries as invoice_time');
    db.tenantJoin(timeLinesQuery, 'time_entries as entry', 'invoice_time.entry_id', 'entry.entry_id');
    db.tenantJoin(timeLinesQuery, 'project_tasks as task', 'entry.work_item_id', 'task.task_id', { type: 'left' });
    db.tenantJoin(timeLinesQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id', { type: 'left' });
    db.tenantJoin(timeLinesQuery, 'projects as project', 'phase.project_id', 'project.project_id', { type: 'left' });
    db.tenantJoin(timeLinesQuery, 'project_billing_configs as config', 'project.project_id', 'config.project_id');
    const timeLines = await timeLinesQuery
      .where('invoice_time.invoice_id', invoiceId)
      .whereNotNull('invoice_time.item_id')
      .where('config.billing_model', 'time_and_materials')
      .select(
        'invoice_time.item_id',
        'project.project_name',
        'project.project_number',
        'phase.phase_name',
      );

    const projectByItemId = new Map(
      [...scheduleLines, ...timeLines].map((line) => [String(line.item_id), line]),
    );
    if (invoiceProject?.project_id) {
      const materialLines = await db.table('invoice_charges')
        .where({ invoice_id: invoiceId, is_discount: false })
        .whereNotNull('service_id')
        .select('item_id');
      for (const materialLine of materialLines) {
        if (!projectByItemId.has(String(materialLine.item_id))) {
          projectByItemId.set(String(materialLine.item_id), invoiceProject);
        }
      }
      viewModel.projectName = invoiceProject.project_name ?? null;
      viewModel.projectNumber = invoiceProject.project_number ?? null;
    }

    for (const item of viewModel.items ?? []) {
      const projectLine = projectByItemId.get(item.id);
      if (!projectLine) continue;
      item.category = `Project: ${projectLine.project_name}`;
      item.itemType = 'project';
      item.projectPhaseName = projectLine.phase_name ?? null;
    }
  } catch (error) {
    console.error('[enrichInvoiceViewModelWithProjects] Failed to load project billing data:', error);
  }
}

/**
 * Resolve each line item's `location_id` against `client_locations` via a
 * single batched tenant-scoped query and attach the full location object to
 * the item. Mutates and returns the given view model.
 */
export async function enrichInvoiceViewModelWithLocations(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  viewModel: WasmInvoiceViewModel,
): Promise<WasmInvoiceViewModel> {
  await enrichInvoiceViewModelWithProjects(knexOrTrx, tenant, viewModel);
  const items = viewModel.items ?? [];

  const locationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  );

  const locationsById = new Map<string, WasmInvoiceLineItemLocation>();

  if (locationIds.length > 0) {
    try {
      const rows = await tenantDb(knexOrTrx, tenant).table('client_locations')
        .select(
          'location_id as id',
          'location_name',
          'address_line1',
          'address_line2',
          'address_line3',
          'city',
          'state_province',
          'postal_code',
          'country_code',
          'country_name',
          'region_code',
        )
        .whereIn('location_id', locationIds);

      for (const row of rows) {
        const record = row as Record<string, unknown>;
        const base: WasmInvoiceLineItemLocation = {
          id: String(record.id),
          location_name: (record.location_name as string | null) ?? null,
          address_line1: (record.address_line1 as string | null) ?? null,
          address_line2: (record.address_line2 as string | null) ?? null,
          address_line3: (record.address_line3 as string | null) ?? null,
          city: (record.city as string | null) ?? null,
          state_province: (record.state_province as string | null) ?? null,
          postal_code: (record.postal_code as string | null) ?? null,
          country_code: (record.country_code as string | null) ?? null,
          country_name: (record.country_name as string | null) ?? null,
          region_code: (record.region_code as string | null) ?? null,
        };
        locationsById.set(base.id, { ...base, full_address: buildLocationAddressBlock(base) });
      }
    } catch (error) {
      console.error('[enrichInvoiceViewModelWithLocations] Failed to load client_locations:', error);
    }
  }

  for (const item of items) {
    if (item.location_id && locationsById.has(item.location_id)) {
      item.location = locationsById.get(item.location_id) ?? null;
    } else if (!item.location) {
      item.location = null;
    }
  }

  viewModel.groupsByLocation = buildInvoiceLocationGroups(items);
  viewModel.hasMultipleLocations = locationsById.size >= 2;

  return viewModel;
}
