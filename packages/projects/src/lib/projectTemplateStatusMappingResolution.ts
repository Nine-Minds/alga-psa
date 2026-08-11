import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IProjectTemplateStatusMapping } from '@alga-psa/types';
import { TEMPLATE_STATUS_MAPPINGS_UNRESOLVED_MESSAGE } from './templateStatusMappingUtils';

export type TemplateStatusSource = 'tenant' | 'standard' | 'inline' | 'unresolved';
export type TemplateUnresolvedReason = 'missing' | 'ambiguous';

export type TemplateStatusMappingRow = {
  template_status_mapping_id: string;
  template_id: string;
  template_phase_id?: string | null;
  status_id?: string | null;
  standard_status_id?: string | null;
  unresolved_status_id?: string | null;
  unresolved_reason?: TemplateUnresolvedReason | string | null;
  status_source?: TemplateStatusSource | string | null;
  custom_status_name?: string | null;
  custom_status_color?: string | null;
  display_order: number;
};

export type ResolvedTemplateStatusMapping =
  | {
      source: 'tenant';
      statusId: string;
      mappingId: string;
      name: string;
      color: string;
      isClosed: boolean;
      displayOrder: number;
      templatePhaseId: string | null;
    }
  | {
      source: 'standard';
      standardStatusId: string;
      mappingId: string;
      name: string;
      color: string;
      isClosed: boolean;
      displayOrder: number;
      templatePhaseId: string | null;
    }
  | {
      source: 'inline';
      name: string;
      color?: string;
      mappingId: string;
      displayOrder: number;
      templatePhaseId: string | null;
    }
  | {
      source: 'unresolved';
      originalStatusId?: string;
      reason: TemplateUnresolvedReason;
      mappingId: string;
      displayOrder: number;
      templatePhaseId: string | null;
    };

type TenantStatusRecord = {
  status_id: string;
  name: string;
  color?: string | null;
  is_closed: boolean;
};

type StandardStatusRecord = {
  standard_status_id: string;
  name: string;
  color?: string | null;
  is_closed: boolean;
};

/**
 * Structured domain error raised when a template still contains unresolved
 * (missing or ambiguous) status mappings. Safe to surface to end users; the
 * code lets callers branch without parsing messages.
 */
export class TemplateStatusMappingsUnresolvedError extends Error {
  readonly code = 'TEMPLATE_STATUS_MAPPINGS_UNRESOLVED' as const;
  readonly details: {
    templateId: string;
    unresolvedMappingIds: string[];
    unresolvedScopes: Array<{ templateStatusMappingId: string; reason: TemplateUnresolvedReason }>;
  };

  constructor(templateId: string, unresolved: Array<{ mappingId: string; reason: TemplateUnresolvedReason }>) {
    super(TEMPLATE_STATUS_MAPPINGS_UNRESOLVED_MESSAGE);
    this.name = 'TemplateStatusMappingsUnresolvedError';
    this.details = {
      templateId,
      unresolvedMappingIds: unresolved.map((entry) => entry.mappingId),
      unresolvedScopes: unresolved.map((entry) => ({
        templateStatusMappingId: entry.mappingId,
        reason: entry.reason,
      })),
    };
  }
}

export function isTemplateStatusMappingsUnresolvedError(
  error: unknown
): error is TemplateStatusMappingsUnresolvedError {
  return error instanceof TemplateStatusMappingsUnresolvedError;
}

function statusSourceOf(row: TemplateStatusMappingRow): TemplateStatusSource | null {
  if (row.status_source === 'tenant' || row.status_source === 'standard' ||
      row.status_source === 'inline' || row.status_source === 'unresolved') {
    return row.status_source;
  }
  return null;
}

function unresolvedReasonOf(row: TemplateStatusMappingRow): TemplateUnresolvedReason | null {
  if (row.unresolved_reason === 'missing' || row.unresolved_reason === 'ambiguous') {
    return row.unresolved_reason;
  }
  return null;
}

/**
 * Decode one persisted row into its typed variant, cross-checked against the
 * referenced catalogs. A referenced target that has disappeared after the
 * typed migration (instead of being quarantined) is surfaced as unresolved
 * rather than silently relabeled or thrown on.
 */
export function decodeTemplateStatusMapping(
  row: TemplateStatusMappingRow,
  tenantStatuses: Map<string, TenantStatusRecord>,
  standardStatuses: Map<string, StandardStatusRecord>
): ResolvedTemplateStatusMapping {
  const mappingId = row.template_status_mapping_id;
  const displayOrder = row.display_order;
  const templatePhaseId = row.template_phase_id ?? null;
  const source = statusSourceOf(row);

  if (source === 'tenant' && row.status_id) {
    const status = tenantStatuses.get(row.status_id);
    if (!status) {
      return {
        source: 'unresolved',
        originalStatusId: row.status_id,
        reason: 'missing',
        mappingId,
        displayOrder,
        templatePhaseId,
      };
    }
    return {
      source: 'tenant',
      statusId: row.status_id,
      mappingId,
      name: status.name,
      color: status.color || '#6B7280',
      isClosed: status.is_closed,
      displayOrder,
      templatePhaseId,
    };
  }

  if (source === 'standard' && row.standard_status_id) {
    const status = standardStatuses.get(row.standard_status_id);
    if (!status) {
      return {
        source: 'unresolved',
        originalStatusId: row.standard_status_id,
        reason: 'missing',
        mappingId,
        displayOrder,
        templatePhaseId,
      };
    }
    return {
      source: 'standard',
      standardStatusId: row.standard_status_id,
      mappingId,
      name: status.name,
      color: status.color || '#6B7280',
      isClosed: status.is_closed,
      displayOrder,
      templatePhaseId,
    };
  }

  if (source === 'inline' || (!source && row.custom_status_name && !row.status_id && !row.standard_status_id)) {
    return {
      source: 'inline',
      name: row.custom_status_name || 'Status',
      color: row.custom_status_color || '#6B7280',
      mappingId,
      displayOrder,
      templatePhaseId,
    };
  }

  return {
    source: 'unresolved',
    originalStatusId: row.unresolved_status_id ?? row.status_id ?? row.standard_status_id ?? undefined,
    reason: unresolvedReasonOf(row) ?? 'ambiguous',
    mappingId,
    displayOrder,
    templatePhaseId,
  };
}

/**
 * Resolve a set of persisted template mapping rows against their referenced
 * tenant and standard catalogs. Batch-loads catalog rows once rather than
 * probing per mapping.
 */
export async function resolveTemplateStatusMappings(
  trx: Knex | Knex.Transaction,
  tenant: string,
  rows: TemplateStatusMappingRow[]
): Promise<ResolvedTemplateStatusMapping[]> {
  const tenantStatusIds = new Set<string>();
  const standardStatusIds = new Set<string>();

  for (const row of rows) {
    const source = statusSourceOf(row);
    if (source === 'tenant' && row.status_id) {
      tenantStatusIds.add(row.status_id);
    } else if (source === 'standard' && row.standard_status_id) {
      standardStatusIds.add(row.standard_status_id);
    }
  }

  const [tenantStatusRows, standardStatusRows] = await Promise.all([
    tenantStatusIds.size > 0
      ? (tenantDb(trx, tenant)
          .table('statuses')
          .whereIn('status_id', Array.from(tenantStatusIds))
          .select('status_id', 'name', 'color', 'is_closed') as unknown as Promise<TenantStatusRecord[]>)
      : Promise.resolve([] as TenantStatusRecord[]),
    standardStatusIds.size > 0
      ? (tenantDb(trx, tenant)
          .table('standard_statuses')
          .whereIn('standard_status_id', Array.from(standardStatusIds))
          .select('standard_status_id', 'name', 'is_closed') as unknown as Promise<StandardStatusRecord[]>)
      : Promise.resolve([] as StandardStatusRecord[]),
  ]);

  const tenantStatusMap = new Map(tenantStatusRows.map((row) => [row.status_id, row]));
  const standardStatusMap = new Map(
    standardStatusRows.map((row) => [row.standard_status_id, row])
  );

  return rows.map((row) => decodeTemplateStatusMapping(row, tenantStatusMap, standardStatusMap));
}

export function unresolvedMappings(
  mappings: ResolvedTemplateStatusMapping[]
): Array<{ mappingId: string; reason: TemplateUnresolvedReason }> {
  return mappings
    .filter((mapping) => mapping.source === 'unresolved')
    .map((mapping) => ({
      mappingId: mapping.mappingId,
      reason: mapping.reason,
    }));
}

/**
 * Count unresolved (missing/ambiguous) mappings for a template, or across all
 * templates when no templateId is given.
 */
export async function countUnresolvedStatusMappings(
  trx: Knex | Knex.Transaction,
  tenant: string,
  templateId?: string
): Promise<number> {
  const query = tenantDb(trx, tenant)
    .table('project_template_status_mappings')
    .where('status_source', 'unresolved');
  if (templateId) {
    query.andWhere({ template_id: templateId });
  }
  const result = await query.count<{ count: string }>('* as count').first();
  return Number(result?.count ?? 0);
}

export type TemplateStatusMappingReplacement =
  | { type: 'tenant'; statusId: string }
  | { type: 'standard'; standardStatusId: string };

/**
 * Replace an existing template status mapping in place, preserving the mapping
 * identity (template_status_mapping_id, template_id, template_phase_id,
 * display_order) so existing template-task assignments keep referencing the
 * same mapping. Shared by the authenticated action and integration tests.
 */
export async function replaceTemplateStatusMappingCore(
  trx: Knex.Transaction,
  tenant: string,
  templateId: string,
  templateStatusMappingId: string,
  replacement: TemplateStatusMappingReplacement
): Promise<{ mapping: IProjectTemplateStatusMapping; unresolvedStatusMappingCount: number }> {
  const mapping = await tenantDb(trx, tenant)
    .table('project_template_status_mappings')
    .where({
      template_status_mapping_id: templateStatusMappingId,
      template_id: templateId,
    })
    .forUpdate()
    .first();

  if (!mapping) {
    throw new Error('Status mapping not found');
  }

  if (replacement.type === 'tenant') {
    const status = await tenantDb(trx, tenant).table('statuses')
      .where({ status_id: replacement.statusId })
      .first();
    if (!status) {
      throw new Error('Status mapping not found');
    }
  } else {
    const status = await tenantDb(trx, tenant).table('standard_statuses')
      .where({ standard_status_id: replacement.standardStatusId })
      .first();
    if (!status) {
      throw new Error('Status mapping not found');
    }
  }

  const updateData = replacement.type === 'tenant'
    ? {
        status_id: replacement.statusId,
        standard_status_id: null,
        unresolved_status_id: null,
        unresolved_reason: null,
        status_source: 'tenant',
      }
    : {
        status_id: null,
        standard_status_id: replacement.standardStatusId,
        unresolved_status_id: null,
        unresolved_reason: null,
        status_source: 'standard',
      };

  const [updated] = await tenantDb(trx, tenant)
    .table('project_template_status_mappings')
    .where({ template_status_mapping_id: templateStatusMappingId })
    .update({
      ...updateData,
      custom_status_name: null,
      custom_status_color: null,
    })
    .returning('*');

  const [resolved] = await resolveTemplateStatusMappings(trx, tenant, [updated]);
  const mappingDto = toTemplateStatusMappingDto(updated, resolved) as unknown as IProjectTemplateStatusMapping;
  const unresolvedStatusMappingCount = await countUnresolvedStatusMappings(trx, tenant, templateId);

  return { mapping: mappingDto, unresolvedStatusMappingCount };
}

/**
 * Apply preflight guard. Throws TemplateStatusMappingsUnresolvedError before any
 * project rows are written when any effective mapping is unresolved.
 */
export function assertTemplateMappingsResolved(
  templateId: string,
  mappings: ResolvedTemplateStatusMapping[]
): void {
  const unresolved = unresolvedMappings(mappings);
  if (unresolved.length > 0) {
    throw new TemplateStatusMappingsUnresolvedError(templateId, unresolved);
  }
}

/**
 * Build the enriched DTO the UI consumes from a persisted row + its resolved
 * variant. Catalog precedence lives in the resolver; this is the only place
 * display metadata is derived.
 */
export function toTemplateStatusMappingDto(
  row: TemplateStatusMappingRow,
  resolved: ResolvedTemplateStatusMapping
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    template_status_mapping_id: row.template_status_mapping_id,
    template_id: row.template_id,
    template_phase_id: row.template_phase_id ?? undefined,
    status_id: row.status_id ?? undefined,
    standard_status_id: row.standard_status_id ?? undefined,
    unresolved_status_id: row.unresolved_status_id ?? undefined,
    unresolved_reason: row.unresolved_reason ?? undefined,
    status_source: row.status_source ?? undefined,
    custom_status_name: row.custom_status_name ?? undefined,
    custom_status_color: row.custom_status_color ?? undefined,
    display_order: row.display_order,
    statusSource: resolved.source,
  };

  switch (resolved.source) {
    case 'tenant':
      return {
        ...base,
        status_name: resolved.name,
        color: resolved.color,
        is_closed: resolved.isClosed,
      };
    case 'standard':
      return {
        ...base,
        status_name: resolved.name,
        color: resolved.color,
        is_closed: resolved.isClosed,
      };
    case 'inline':
      return {
        ...base,
        status_name: resolved.name,
        color: resolved.color,
        is_closed: false,
      };
    case 'unresolved':
      return {
        ...base,
        status_name: undefined,
        color: '#6B7280',
        is_closed: false,
      };
  }
}
