const { unicodeLowerV1 } = require('./checklistUnicodeLower.cjs');

/** Convert the pre-predicate checklist rule format to predicate format version 1. */
function legacyChecklistRuleToPredicate(rule) {
  const clauses = [];
  for (const path of ['board_id', 'category_id', 'subcategory_id', 'priority_id']) {
    if (rule[path] != null) clauses.push({ path, operator: 'equals', value: rule[path] });
  }
  for (const [column, path] of [['client_ids', 'client.id'], ['ticket_origins', 'ticket_origin']]) {
    if (rule[column]?.length) clauses.push({ path, operator: 'in', value: rule[column] });
  }
  if (rule.service_request_definition_id) {
    clauses.push({ path: 'service_request_definition_id', operator: 'equals', value: rule.service_request_definition_id });
  } else if (rule.from_service_request) {
    clauses.push({ path: 'from_service_request', operator: 'equals', value: true });
  }
  const keywords = (rule.keywords ?? []).map((keyword) => unicodeLowerV1(keyword.trim())).filter(Boolean);
  if (keywords.length) {
    const target = rule.keyword_target ?? 'title_and_description';
    const keywordClauses = keywords.map((keyword) => {
      const title = { path: 'title_folded', operator: 'contains', value: keyword };
      const description = { path: 'description_folded', operator: 'contains', value: keyword };
      if (target === 'title') return title;
      if (target === 'description') return description;
      return { join: 'or', clauses: [title, description] };
    });
    clauses.push({ join: rule.keyword_mode === 'all' ? 'and' : 'or', clauses: keywordClauses });
  }
  return { join: 'and', clauses };
}

module.exports = { legacyChecklistRuleToPredicate };
