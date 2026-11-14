import { describe, expect, it } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import { shapeConversationAuthor } from '../ticketConversation';
import { localAuthorReference, LOCAL_AUTHOR_REFERENCE_NAMESPACE } from '../conversationAuthorReference';

const row = (over: Record<string, unknown>) => ({ store_tenant: 'cust', actor_tenant: 'cust', actor_kind: 'user', actor_id: 'u-1', actor_reference_id: null,
  actor_display_name: 'Dana', actor_organization_name: 'Cust', ...over });

describe('shapeConversationAuthor', () => {
  it('keeps the raw id and reference for the viewer\'s own tenant', () => {
    expect(shapeConversationAuthor(row({ actor_reference_id: 'ref' }), 'cust')).toEqual({ tenant: 'cust', kind: 'user', id: 'u-1', referenceId: 'ref', displayName: 'Dana', organizationName: 'Cust' });
    expect(shapeConversationAuthor(row({ actor_kind: 'contact', actor_id: 'c-1' }), 'cust')).toMatchObject({ id: 'c-1', referenceId: null });
  });

  it.each(['user', 'contact'])('nulls a foreign store-local %s id and derives the stable uuidv5 reference', kind => {
    const author = shapeConversationAuthor(row({ actor_kind: kind, actor_id: 'raw-id' }), 'msp');
    expect(author.id).toBeNull();
    expect(author.referenceId).toBe(uuidv5(`cust:${kind}:raw-id`, '6f0c5e0e-3a54-4f0b-9f0d-5b7f2f5a1c11'));
    expect(author).toMatchObject({ tenant: 'cust', kind, displayName: 'Dana', organizationName: 'Cust' });
    expect(JSON.stringify(author)).not.toContain('raw-id');
  });

  it('prefers the stored actor reference and hides the sponsor technician id from a foreign viewer', () => {
    expect(shapeConversationAuthor(row({ actor_tenant: 'msp', actor_id: 'tech', actor_reference_id: 'ref' }), 'cust')).toMatchObject({ id: null, referenceId: 'ref' });
  });

  it.each(['system', 'unknown'])('gives %s authors no id and no derived reference', kind => {
    expect(shapeConversationAuthor(row({ actor_kind: kind, actor_id: null }), 'msp')).toMatchObject({ id: null, referenceId: null });
  });
});

describe('localAuthorReference', () => {
  it('is uuid v5 over `${tenant}:${kind}:${id}` in the fixed namespace', () => {
    expect(LOCAL_AUTHOR_REFERENCE_NAMESPACE).toBe('6f0c5e0e-3a54-4f0b-9f0d-5b7f2f5a1c11');
    expect(localAuthorReference('t', 'user', 'i')).toBe(uuidv5('t:user:i', '6f0c5e0e-3a54-4f0b-9f0d-5b7f2f5a1c11'));
  });
});
