'use strict';

/**
 * Pure mapping for migration `20261017120100_backfill_recurring_ticket_templates`: how a legacy
 * recurring-ticket definition (which embedded its own ticket fields) becomes a `ticket_templates` row.
 * No database access here so the rules are unit-tested (server/migrations/__tests__).
 */

const NAME_MAX = 200;
const MIGRATION_NOTE_PREFIX = 'Created from recurring schedule ';

function asJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

/**
 * A template name that is unique (case-insensitively) among `takenLowercased`, which is the set of
 * ACTIVE template names (matching `ticket_templates_active_name_unique`). The base name is kept when
 * free; otherwise " (recurring)", then " (recurring 2)", " (recurring 3)", ... The chosen name is added
 * to `takenLowercased` so successive definitions in one batch cannot collide with each other.
 */
function dedupeTemplateName(baseName, takenLowercased) {
  const trimmed = String(baseName ?? '').trim() || 'Recurring schedule';
  const fit = (suffix) => `${trimmed.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;

  let candidate = fit('');
  if (takenLowercased.has(candidate.toLowerCase())) {
    candidate = fit(' (recurring)');
    for (let n = 2; takenLowercased.has(candidate.toLowerCase()); n += 1) {
      candidate = fit(` (recurring ${n})`);
    }
  }
  takenLowercased.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param definition  a `recurring_ticket_definitions` row (content columns only are read)
 * @param checklistItems  rows of the definition's `checklist_template_id` (`checklist_template_items`), any order
 * @param takenLowercased  mutable set of lower-cased active template names
 * @returns `{ template, items }` ready to insert (without tenant / template_id)
 */
function mapDefinitionToTemplate(definition, checklistItems, takenLowercased) {
  const name = dedupeTemplateName(definition.name, takenLowercased);
  const description = definition.description === null || definition.description === undefined
    ? null
    // R7: identical to what the legacy generator passed to createTicket (JSON.stringify of the parsed jsonb).
    : JSON.stringify(asJson(definition.description, null));

  const template = {
    name,
    notes: `${MIGRATION_NOTE_PREFIX}${definition.name} on migration`,
    title: definition.title_template,
    description,
    board_id: definition.board_id ?? null,
    category_id: definition.category_id ?? null,
    subcategory_id: definition.category_id ? definition.subcategory_id ?? null : null,
    priority_id: definition.priority_id ?? null,
    itil_impact: null,
    itil_urgency: null,
    tags: JSON.stringify(asJson(definition.tags, [])),
    custom_fields: '{}',
    offer_for_manual_use: false, // R5
    is_active: true,
    source_ticket_id: null,
  };

  const checklistTemplateId = definition.checklist_template_id ?? null;
  const items = checklistTemplateId
    ? [...checklistItems]
        .sort((a, b) => Number(a.order_number ?? 0) - Number(b.order_number ?? 0))
        .map((item, index) => ({
          item_name: item.item_name,
          description: item.description ?? null,
          is_required: item.is_required !== false,
          order_number: index,
          // R6: kept so the replacement rule still prevents doubling with board auto-apply.
          checklist_template_id: checklistTemplateId,
        }))
    : [];

  return { template, items };
}

module.exports = { dedupeTemplateName, mapDefinitionToTemplate, MIGRATION_NOTE_PREFIX };
