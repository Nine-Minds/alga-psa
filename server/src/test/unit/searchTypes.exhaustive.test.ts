import { describe, expect, it } from 'vitest';

import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '../../lib/search/types';

function exhaustiveSearchTypeLabel(type: SearchObjectType): string {
  switch (type) {
    case 'client':
    case 'contact':
    case 'user':
    case 'ticket':
    case 'ticket_comment':
    case 'project':
    case 'project_phase':
    case 'project_task':
    case 'project_task_comment':
    case 'asset':
    case 'invoice':
    case 'invoice_item':
    case 'invoice_annotation':
    case 'contract':
    case 'client_contract':
    case 'document':
    case 'kb_article':
    case 'service_catalog':
    case 'service_request_submission':
    case 'service_request_definition':
    case 'workflow_task':
    case 'interaction':
    case 'schedule_entry':
    case 'time_entry':
    case 'board':
    case 'category':
    case 'tag':
      return type;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

describe('SearchObjectType exhaustiveness', () => {
  it('T011 covers all 27 app-wide search object types with an exhaustive switch', () => {
    const labels = SEARCH_OBJECT_TYPES.map(exhaustiveSearchTypeLabel);

    expect(SEARCH_OBJECT_TYPES).toHaveLength(27);
    expect(new Set(SEARCH_OBJECT_TYPES)).toHaveProperty('size', 27);
    expect(labels).toEqual([...SEARCH_OBJECT_TYPES]);
  });
});
