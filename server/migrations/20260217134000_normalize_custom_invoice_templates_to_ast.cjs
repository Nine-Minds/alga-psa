/**
 * Normalize tenant invoice templates to canonical AST-backed records.
 *
 * This migration is idempotent and performs:
 * - Backfill of missing invoice_templates.templateAst
 * - Tenant-scope default assignment normalization to a custom template copy
 * - Auto-healing for dangling custom assignment references
 */

const INVOICE_TEMPLATES_TABLE = 'invoice_templates';
const ASSIGNMENTS_TABLE = 'invoice_template_assignments';

const TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const buildSharedBindings = () => ({
  values: {
    invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
    poNumber: { id: 'poNumber', kind: 'value', path: 'poNumber' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total' },
    tenantClientName: {
      id: 'tenantClientName',
      kind: 'value',
      path: 'tenantClient.name',
      fallback: 'Your Company',
    },
    tenantClientAddress: {
      id: 'tenantClientAddress',
      kind: 'value',
      path: 'tenantClient.address',
      fallback: 'Company address',
    },
    tenantClientLogo: {
      id: 'tenantClientLogo',
      kind: 'value',
      path: 'tenantClient.logoUrl',
      fallback: TRANSPARENT_PIXEL_DATA_URI,
    },
    customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
    customerAddress: {
      id: 'customerAddress',
      kind: 'value',
      path: 'customer.address',
      fallback: 'Customer address',
    },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
  },
});

const buildStandardDefaultAst = (templateName) => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName,
  },
  bindings: buildSharedBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'section',
        title: 'Invoice',
        children: [
          {
            id: 'invoice-number',
            type: 'field',
            label: 'Invoice #',
            binding: { bindingId: 'invoiceNumber' },
          },
          {
            id: 'issue-date',
            type: 'field',
            label: 'Issue Date',
            binding: { bindingId: 'issueDate' },
            format: 'date',
          },
          {
            id: 'due-date',
            type: 'field',
            label: 'Due Date',
            binding: { bindingId: 'dueDate' },
            format: 'date',
          },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        columns: [
          {
            id: 'description',
            header: 'Description',
            value: { type: 'path', path: 'description' },
          },
          {
            id: 'quantity',
            header: 'Qty',
            value: { type: 'path', path: 'quantity' },
            format: 'number',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'unit-price',
            header: 'Rate',
            value: { type: 'path', path: 'unitPrice' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'line-total',
            header: 'Amount',
            value: { type: 'path', path: 'total' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'subtotal',
            label: 'Subtotal',
            value: { type: 'binding', bindingId: 'subtotal' },
            format: 'currency',
          },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          {
            id: 'total',
            label: 'Total',
            value: { type: 'binding', bindingId: 'total' },
            format: 'currency',
            emphasize: true,
          },
        ],
      },
    ],
  },
});

const buildStandardDetailedAst = () => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName: 'Detailed Template',
  },
  bindings: buildSharedBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: {
          inline: {
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '24px',
            margin: '0 0 20px 0',
          },
        },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '6px',
              },
            },
            children: [
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantClientLogo' },
                alt: {
                  type: 'template',
                  template: '{{name}} logo',
                  args: {
                    name: { type: 'binding', bindingId: 'tenantClientName' },
                  },
                },
                style: {
                  inline: {
                    width: '180px',
                    maxHeight: '72px',
                    margin: '0 0 6px 0',
                  },
                },
              },
              {
                id: 'issuer-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientName' },
                style: {
                  inline: {
                    fontSize: '18px',
                    fontWeight: 700,
                    lineHeight: 1.2,
                  },
                },
              },
              {
                id: 'issuer-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientAddress' },
                style: {
                  inline: {
                    color: '#4b5563',
                    lineHeight: 1.4,
                  },
                },
              },
            ],
          },
          {
            id: 'invoice-meta-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                minWidth: '280px',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '14px 16px',
                backgroundColor: '#f9fafb',
                gap: '6px',
              },
            },
            children: [
              {
                id: 'invoice-title',
                type: 'text',
                content: { type: 'literal', value: 'INVOICE' },
                style: {
                  inline: {
                    fontSize: '22px',
                    fontWeight: 700,
                    margin: '0 0 4px 0',
                    lineHeight: 1.1,
                  },
                },
              },
              {
                id: 'invoice-number',
                type: 'field',
                label: 'Invoice #',
                binding: { bindingId: 'invoiceNumber' },
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'issue-date',
                type: 'field',
                label: 'Issue Date',
                binding: { bindingId: 'issueDate' },
                format: 'date',
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'due-date',
                type: 'field',
                label: 'Due Date',
                binding: { bindingId: 'dueDate' },
                format: 'date',
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'po-number',
                type: 'field',
                label: 'PO #',
                binding: { bindingId: 'poNumber' },
                emptyValue: '-',
                style: { inline: { justifyContent: 'space-between' } },
              },
            ],
          },
        ],
      },
      {
        id: 'header-divider',
        type: 'divider',
        style: {
          inline: {
            margin: '0 0 20px 0',
          },
        },
      },
      {
        id: 'party-blocks',
        type: 'stack',
        direction: 'row',
        style: {
          inline: {
            gap: '24px',
            margin: '0 0 20px 0',
          },
        },
        children: [
          {
            id: 'from-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '4px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px 14px',
              },
            },
            children: [
              {
                id: 'from-label',
                type: 'text',
                content: { type: 'literal', value: 'From' },
                style: {
                  inline: {
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 700,
                    margin: '0 0 2px 0',
                  },
                },
              },
              {
                id: 'from-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientName' },
                style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } },
              },
              {
                id: 'from-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientAddress' },
                style: { inline: { color: '#4b5563', lineHeight: 1.4 } },
              },
            ],
          },
          {
            id: 'bill-to-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '4px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px 14px',
              },
            },
            children: [
              {
                id: 'bill-to-label',
                type: 'text',
                content: { type: 'literal', value: 'Bill To' },
                style: {
                  inline: {
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 700,
                    margin: '0 0 2px 0',
                  },
                },
              },
              {
                id: 'bill-to-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'customerName' },
                style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } },
              },
              {
                id: 'bill-to-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'customerAddress' },
                style: { inline: { color: '#4b5563', lineHeight: 1.4 } },
              },
            ],
          },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: {
          inline: {
            margin: '0 0 16px 0',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
          },
        },
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        emptyStateText: 'No billable line items',
        columns: [
          {
            id: 'description',
            header: 'Description',
            value: { type: 'path', path: 'description' },
            style: { inline: { width: '50%' } },
          },
          {
            id: 'quantity',
            header: 'Qty',
            value: { type: 'path', path: 'quantity' },
            format: 'number',
            style: { inline: { textAlign: 'right', width: '14%' } },
          },
          {
            id: 'unit-price',
            header: 'Rate',
            value: { type: 'path', path: 'unitPrice' },
            format: 'currency',
            style: { inline: { textAlign: 'right', width: '18%' } },
          },
          {
            id: 'line-total',
            header: 'Amount',
            value: { type: 'path', path: 'total' },
            format: 'currency',
            style: { inline: { textAlign: 'right', width: '18%' } },
          },
        ],
      },
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: {
              inline: {
                width: '300px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '10px 12px',
                backgroundColor: '#f9fafb',
              },
            },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              {
                id: 'subtotal',
                label: 'Subtotal',
                value: { type: 'binding', bindingId: 'subtotal' },
                format: 'currency',
              },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              {
                id: 'total',
                label: 'Total',
                value: { type: 'binding', bindingId: 'total' },
                format: 'currency',
                emphasize: true,
              },
            ],
          },
        ],
      },
    ],
  },
});

const STANDARD_TEMPLATE_DEFS = {
  'standard-default': {
    code: 'standard-default',
    name: 'Standard Template',
    templateAst: buildStandardDefaultAst('Standard Template'),
  },
  'standard-detailed': {
    code: 'standard-detailed',
    name: 'Detailed Template',
    templateAst: buildStandardDetailedAst(),
  },
};

const STANDARD_DEFAULT_CODE = 'standard-default';
const STANDARD_DETAILED_CODE = 'standard-detailed';

const inferStandardCodeFromName = (name) => {
  const normalized = (name || '').toLowerCase();
  if (normalized.includes('detailed')) {
    return STANDARD_DETAILED_CODE;
  }
  return STANDARD_DEFAULT_CODE;
};

const getCanonicalAstJsonForCode = (code) => {
  const resolvedCode = STANDARD_TEMPLATE_DEFS[code] ? code : STANDARD_DEFAULT_CODE;
  return JSON.stringify(STANDARD_TEMPLATE_DEFS[resolvedCode].templateAst);
};

async function ensureTemplateAstColumn(knex) {
  const hasTemplateAst = await knex.schema.hasColumn(INVOICE_TEMPLATES_TABLE, 'templateAst');
  if (!hasTemplateAst) {
    await knex.schema.alterTable(INVOICE_TEMPLATES_TABLE, (table) => {
      table.jsonb('templateAst').nullable().comment('Canonical invoice template JSON AST payload.');
    });
  }
}

async function backfillMissingTemplateAst(knex) {
  const missingRows = await knex(INVOICE_TEMPLATES_TABLE)
    .select('tenant', 'template_id', 'name')
    .whereNull('templateAst');

  for (const row of missingRows) {
    const inferredCode = inferStandardCodeFromName(row.name);
    const astJson = getCanonicalAstJsonForCode(inferredCode);
    await knex(INVOICE_TEMPLATES_TABLE)
      .where({ tenant: row.tenant, template_id: row.template_id })
      .update({
        templateAst: knex.raw('?::jsonb', [astJson]),
        updated_at: knex.fn.now(),
      });
  }
}

async function getCustomSignalTenants(knex) {
  const rows = await knex
    .select('tenant')
    .from(function customSignalTenantUnion() {
      this.select('tenant')
        .from(INVOICE_TEMPLATES_TABLE)
        .whereRaw('COALESCE(is_default, false) = false')
        .union(function unionCustomAssignments() {
          this.select('tenant')
            .from(ASSIGNMENTS_TABLE)
            .where({ template_source: 'custom' });
        })
        .as('custom_signal_tenants');
    })
    .groupBy('tenant');

  return rows.map((row) => row.tenant);
}

async function getTenantTemplates(knex, tenant) {
  const standardDefaultAst = getCanonicalAstJsonForCode(STANDARD_DEFAULT_CODE);
  const standardDetailedAst = getCanonicalAstJsonForCode(STANDARD_DETAILED_CODE);

  return knex(INVOICE_TEMPLATES_TABLE)
    .select(
      'template_id',
      'name',
      'is_default',
      'created_at',
      knex.raw(
        `CASE
           WHEN "templateAst" = ?::jsonb THEN ?
           WHEN "templateAst" = ?::jsonb THEN ?
           ELSE NULL
         END AS standard_code_match`,
        [standardDefaultAst, STANDARD_DEFAULT_CODE, standardDetailedAst, STANDARD_DETAILED_CODE]
      )
    )
    .where({ tenant })
    .orderBy('created_at', 'asc');
}

async function ensureTenantTemplateCopy(knex, tenant, standardCode) {
  const resolvedCode = STANDARD_TEMPLATE_DEFS[standardCode] ? standardCode : STANDARD_DEFAULT_CODE;
  const templateDef = STANDARD_TEMPLATE_DEFS[resolvedCode];
  const astJson = JSON.stringify(templateDef.templateAst);
  const preferredName = `${templateDef.name} (Copy)`;

  let existing = await knex(INVOICE_TEMPLATES_TABLE)
    .select('template_id')
    .where({ tenant })
    .whereRaw('"templateAst" = ?::jsonb', [astJson])
    .orderBy('created_at', 'asc')
    .first();

  if (existing?.template_id) {
    return existing.template_id;
  }

  existing = await knex(INVOICE_TEMPLATES_TABLE)
    .select('template_id')
    .where({ tenant, name: preferredName })
    .first();

  if (existing?.template_id) {
    await knex(INVOICE_TEMPLATES_TABLE)
      .where({ tenant, template_id: existing.template_id })
      .update({
        version: 1,
        templateAst: knex.raw('?::jsonb', [astJson]),
        updated_at: knex.fn.now(),
      });
    return existing.template_id;
  }

  const created = await knex(INVOICE_TEMPLATES_TABLE)
    .insert({
      tenant,
      template_id: knex.raw('gen_random_uuid()'),
      name: preferredName,
      version: 1,
      is_default: false,
      templateAst: knex.raw('?::jsonb', [astJson]),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .returning('template_id');

  const first = created?.[0];
  return first?.template_id || first;
}

function choosePreferredTemplateId(templates) {
  if (!templates || templates.length === 0) {
    return null;
  }

  const explicitDefault = templates.find((template) => Boolean(template.is_default));
  if (explicitDefault?.template_id) {
    return explicitDefault.template_id;
  }

  const standardDefaultMatch = templates.find((template) => template.standard_code_match === STANDARD_DEFAULT_CODE);
  if (standardDefaultMatch?.template_id) {
    return standardDefaultMatch.template_id;
  }

  const standardDetailedMatch = templates.find((template) => template.standard_code_match === STANDARD_DETAILED_CODE);
  if (standardDetailedMatch?.template_id) {
    return standardDetailedMatch.template_id;
  }

  return templates[0].template_id;
}

async function upsertTenantScopeCustomAssignment(knex, tenant, templateId) {
  const tenantScopeRows = await knex(ASSIGNMENTS_TABLE)
    .select('assignment_id')
    .where({ tenant, scope_type: 'tenant' })
    .whereNull('scope_id')
    .orderBy('created_at', 'asc');

  if (tenantScopeRows.length === 0) {
    await knex(ASSIGNMENTS_TABLE).insert({
      tenant,
      scope_type: 'tenant',
      scope_id: null,
      template_source: 'custom',
      standard_invoice_template_code: null,
      invoice_template_id: templateId,
      created_by: null,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    return;
  }

  const [primary, ...duplicates] = tenantScopeRows;

  await knex(ASSIGNMENTS_TABLE)
    .where({ assignment_id: primary.assignment_id })
    .update({
      template_source: 'custom',
      standard_invoice_template_code: null,
      invoice_template_id: templateId,
      updated_at: knex.fn.now(),
    });

  if (duplicates.length > 0) {
    const duplicateIds = duplicates.map((row) => row.assignment_id);
    await knex(ASSIGNMENTS_TABLE)
      .whereIn('assignment_id', duplicateIds)
      .del();
  }
}

async function healBrokenCustomAssignments(knex, tenant, fallbackTemplateId) {
  const brokenAssignments = await knex(`${ASSIGNMENTS_TABLE} as ita`)
    .leftJoin(`${INVOICE_TEMPLATES_TABLE} as it`, function joinTemplate() {
      this.on('it.tenant', '=', 'ita.tenant').andOn('it.template_id', '=', 'ita.invoice_template_id');
    })
    .select('ita.assignment_id')
    .where('ita.tenant', tenant)
    .where('ita.template_source', 'custom')
    .whereNull('it.template_id');

  if (brokenAssignments.length === 0) {
    return;
  }

  const assignmentIds = brokenAssignments.map((row) => row.assignment_id);
  await knex(ASSIGNMENTS_TABLE)
    .whereIn('assignment_id', assignmentIds)
    .update({
      invoice_template_id: fallbackTemplateId,
      standard_invoice_template_code: null,
      updated_at: knex.fn.now(),
    });
}

async function normalizeTenantAssignments(knex, tenant) {
  let templates = await getTenantTemplates(knex, tenant);

  if (templates.length === 0) {
    const defaultCopyId = await ensureTenantTemplateCopy(knex, tenant, STANDARD_DEFAULT_CODE);
    templates = await getTenantTemplates(knex, tenant);
    await upsertTenantScopeCustomAssignment(knex, tenant, defaultCopyId);
  } else {
    const tenantScopeAssignment = await knex(ASSIGNMENTS_TABLE)
      .select(
        'assignment_id',
        'template_source',
        'standard_invoice_template_code',
        'invoice_template_id'
      )
      .where({ tenant, scope_type: 'tenant' })
      .whereNull('scope_id')
      .orderBy('created_at', 'asc')
      .first();

    const validTemplateIds = new Set(templates.map((template) => template.template_id));

    if (!tenantScopeAssignment) {
      const preferredTemplateId = choosePreferredTemplateId(templates);
      const targetTemplateId = preferredTemplateId || (await ensureTenantTemplateCopy(knex, tenant, STANDARD_DEFAULT_CODE));
      await upsertTenantScopeCustomAssignment(knex, tenant, targetTemplateId);
    } else if (tenantScopeAssignment.template_source === 'standard') {
      const standardCode = tenantScopeAssignment.standard_invoice_template_code || STANDARD_DEFAULT_CODE;
      const copyTemplateId = await ensureTenantTemplateCopy(knex, tenant, standardCode);
      await upsertTenantScopeCustomAssignment(knex, tenant, copyTemplateId);
    } else {
      let targetTemplateId = tenantScopeAssignment.invoice_template_id;
      if (!targetTemplateId || !validTemplateIds.has(targetTemplateId)) {
        targetTemplateId = choosePreferredTemplateId(templates);
      }
      if (!targetTemplateId) {
        targetTemplateId = await ensureTenantTemplateCopy(knex, tenant, STANDARD_DEFAULT_CODE);
      }
      await upsertTenantScopeCustomAssignment(knex, tenant, targetTemplateId);
    }
  }

  const tenantScopeAfter = await knex(ASSIGNMENTS_TABLE)
    .select('invoice_template_id')
    .where({
      tenant,
      scope_type: 'tenant',
      template_source: 'custom',
    })
    .whereNull('scope_id')
    .first();

  let fallbackTemplateId = tenantScopeAfter?.invoice_template_id || null;
  if (!fallbackTemplateId) {
    fallbackTemplateId = choosePreferredTemplateId(await getTenantTemplates(knex, tenant));
  }
  if (!fallbackTemplateId) {
    fallbackTemplateId = await ensureTenantTemplateCopy(knex, tenant, STANDARD_DEFAULT_CODE);
    await upsertTenantScopeCustomAssignment(knex, tenant, fallbackTemplateId);
  }

  await healBrokenCustomAssignments(knex, tenant, fallbackTemplateId);

  await knex(INVOICE_TEMPLATES_TABLE)
    .where({ tenant })
    .update({
      is_default: false,
      updated_at: knex.fn.now(),
    });

  await knex(INVOICE_TEMPLATES_TABLE)
    .where({ tenant, template_id: fallbackTemplateId })
    .update({
      is_default: true,
      updated_at: knex.fn.now(),
    });
}

exports.up = async function up(knex) {
  const hasTemplatesTable = await knex.schema.hasTable(INVOICE_TEMPLATES_TABLE);
  const hasAssignmentsTable = await knex.schema.hasTable(ASSIGNMENTS_TABLE);
  if (!hasTemplatesTable || !hasAssignmentsTable) {
    return;
  }

  await ensureTemplateAstColumn(knex);
  await backfillMissingTemplateAst(knex);

  const customSignalTenants = await getCustomSignalTenants(knex);
  for (const tenant of customSignalTenants) {
    await normalizeTenantAssignments(knex, tenant);
  }
};

exports.down = async function down() {
  // No-op: this migration mutates live template data for canonical AST cutover.
};
