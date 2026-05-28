import { describe, expect, it } from 'vitest';

import {
  SEARCH_OBJECT_TYPES,
  type AclMetadata,
  type SearchDoc,
  type SearchObjectType,
} from '@alga-psa/types';

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
    case 'status':
      return type;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

describe('SearchObjectType exhaustiveness', () => {
  it('T011 covers all 28 app-wide search object types with an exhaustive switch', () => {
    const labels = SEARCH_OBJECT_TYPES.map(exhaustiveSearchTypeLabel);

    expect(SEARCH_OBJECT_TYPES).toHaveLength(28);
    expect(new Set(SEARCH_OBJECT_TYPES)).toHaveProperty('size', 28);
    expect(labels).toEqual([...SEARCH_OBJECT_TYPES]);
  });

  it('T012 requires SearchDoc ACL metadata and exposes every denormalized ACL hint', () => {
    const acl = {
      visibleToUserIds: ['user-1'],
      visibleToRoles: ['technician'],
      isInternalOnly: true,
      isPrivate: true,
      clientScopeId: 'client-1',
      requiredPermission: 'ticket:read',
    } satisfies AclMetadata;
    const doc = {
      tenant: 'tenant-1',
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'Ticket',
      url: '/msp/tickets/ticket-1',
      acl,
      sourceUpdatedAt: new Date('2026-05-13T00:00:00.000Z'),
    } satisfies SearchDoc;

    // @ts-expect-error SearchDoc rows must always carry explicit ACL metadata.
    const missingAclDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'Ticket',
      url: '/msp/tickets/ticket-1',
      sourceUpdatedAt: new Date('2026-05-13T00:00:00.000Z'),
    };

    expect(doc.acl).toEqual(acl);
    expect(missingAclDoc).toBeDefined();
  });
});
