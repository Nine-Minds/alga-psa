/**
 * Shared logic for the service-period / currency refresh of the standard invoice
 * templates (see migration 20261020000000_invoice_templates_service_period_and_currency.cjs).
 *
 * Pure functions only, so the migration's behaviour is unit-testable without a DB.
 *
 * `previousStandardInvoiceTemplateAsts.20261020.json` is a FROZEN snapshot of
 * STANDARD_INVOICE_TEMPLATE_ASTS as it stood immediately before this change. It is
 * deliberately not imported from packages/billing: that module keeps changing, and a
 * migration must keep meaning what it meant the day it shipped.
 */

const PREVIOUS_STANDARD_ASTS = require('./previousStandardInvoiceTemplateAsts.20261020.json');

const SERVICE_PERIOD_HEADER = { i18nKey: 'labels.servicePeriod', defaultValue: 'Service Period' };
const CURRENCY_LABEL = { i18nKey: 'labels.currency', defaultValue: 'Currency' };

// Line tables that get the column: table node id -> where it goes and the column
// widths that make room for it (applied only to columns that already carry a width,
// so a table without explicit widths stays without).
const TABLE_PLANS = {
  'line-items': {
    afterColumn: 'description',
    columnId: 'service-period',
    widths: { description: '34%', 'service-period': '20%', quantity: '10%' },
  },
  'recurring-items': {
    afterColumn: 'description',
    columnId: 'service-period',
    widths: { description: '32%', 'service-period': '20%', 'unit-price': '16%', quantity: '10%', 'line-total': '22%' },
  },
  'onetime-items': {
    afterColumn: 'description',
    columnId: 'service-period',
    widths: { description: '32%', 'service-period': '20%', 'unit-price': '16%', quantity: '10%', 'line-total': '22%' },
  },
  'location-band-items': {
    afterColumn: 'description',
    columnId: 'service-period',
    widths: { description: '34%', 'service-period': '20%', quantity: '10%' },
  },
  'ticket-time-summary': {
    afterColumn: 'ticket-description',
    columnId: 'ticket-service-period',
    widths: {
      ticket: '20%',
      'ticket-description': '26%',
      'ticket-service-period': '18%',
      'ticket-hours': '8%',
      'ticket-rate': '13%',
      'ticket-amount': '15%',
    },
  },
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Key-sorted JSON: jsonb does not preserve key order, so comparisons must not depend on it. */
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));

const insertAfter = (list, afterId, entry) => {
  const index = list.findIndex((item) => item?.id === afterId);
  if (index < 0) list.push(entry);
  else list.splice(index + 1, 0, entry);
};

const addServicePeriodColumn = (node) => {
  const plan = TABLE_PLANS[node.id];
  if (!plan || node.type !== 'dynamic-table' || !Array.isArray(node.columns)) return;
  if (node.columns.some((column) => column?.value?.path === 'servicePeriodLabel')) return;
  const anchor = node.columns.find((column) => column?.id === plan.afterColumn);
  if (!anchor) return; // not the shape this migration knows; leave the table alone
  const column = {
    id: plan.columnId,
    header: clone(SERVICE_PERIOD_HEADER),
    value: { type: 'path', path: 'servicePeriodLabel' },
  };
  const anchorWidth = anchor.style?.inline?.width;
  if (anchorWidth) {
    for (const entry of [...node.columns, column]) {
      const width = plan.widths[entry.id];
      if (width === undefined) continue;
      entry.style = entry.style ?? {};
      entry.style.inline = entry.style.inline ?? {};
      entry.style.inline.width = width;
    }
    // The new column is the only one whose style the plan creates; keep it width-only.
  }
  insertAfter(node.columns, plan.afterColumn, column);
};

const addCurrencyField = (node) => {
  if (!Array.isArray(node.children)) return;
  const bound = (child) => child?.binding?.bindingId === 'currencyCode';
  if (node.children.some(bound)) return;
  const anchorId = node.children.some((child) => child?.id === 'po-number') ? 'po-number' : 'due-date';
  const anchor = node.children.find((child) => child?.id === anchorId);
  if (!anchor || anchor.type !== 'field') return;
  const field = {
    id: 'currency',
    type: 'field',
    label: clone(CURRENCY_LABEL),
    binding: { bindingId: 'currencyCode' },
  };
  if (anchor.style) field.style = clone(anchor.style);
  insertAfter(node.children, anchorId, field);
};

const addCurrencyTotalsRow = (node) => {
  if (node.type !== 'totals' || !Array.isArray(node.rows)) return;
  if (node.rows.some((row) => row?.value?.bindingId === 'currencyCode')) return;
  node.rows.push({
    id: 'currency',
    label: clone(CURRENCY_LABEL),
    value: { type: 'binding', bindingId: 'currencyCode' },
  });
};

const visit = (node) => {
  if (!isRecord(node)) return;
  addServicePeriodColumn(node);
  addCurrencyField(node);
  addCurrencyTotalsRow(node);
  if (Array.isArray(node.children)) node.children.forEach(visit);
};

/**
 * Idempotently adds: the `currencyCode` binding, one Service Period column per standard
 * line table, a Currency field in the header/meta card and a Currency row in the totals.
 * Returns a new AST; the input is not mutated.
 */
const applyServicePeriodAndCurrency = (ast) => {
  const next = clone(ast);
  if (!isRecord(next.layout)) return next;
  const values = next.bindings?.values;
  if (isRecord(values) && !values.currencyCode) {
    next.bindings.values = { ...values, currencyCode: { id: 'currencyCode', kind: 'value', path: 'currencyCode' } };
  }
  visit(next.layout);
  return next;
};

/**
 * The standard code whose frozen previous AST is exactly `ast`, or null. Used to decide
 * whether a tenant's custom template is still an untouched clone of a standard one.
 * An edited template (any difference at all) never matches.
 */
const matchPreviousStandardCode = (ast) => {
  if (!isRecord(ast)) return null;
  const candidate = canonicalJson(ast);
  for (const [code, previous] of Object.entries(PREVIOUS_STANDARD_ASTS)) {
    if (canonicalJson(previous) === candidate) return code;
  }
  return null;
};

module.exports = {
  PREVIOUS_STANDARD_ASTS,
  applyServicePeriodAndCurrency,
  matchPreviousStandardCode,
  canonicalJson,
};
