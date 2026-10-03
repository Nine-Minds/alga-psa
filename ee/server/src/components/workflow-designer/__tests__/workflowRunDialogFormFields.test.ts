import { describe, expect, it } from 'vitest';

import { applyDerivedClientScope, humanizeRunDialogFieldLabel } from '../workflowRunDialogUtils';

describe('run dialog form field labels', () => {
  it('turns schema keys into readable labels without id suffixes', () => {
    expect(humanizeRunDialogFieldLabel('actorUserId')).toBe('Actor user');
    expect(humanizeRunDialogFieldLabel('contactId')).toBe('Contact');
    expect(humanizeRunDialogFieldLabel('ticketId')).toBe('Ticket');
    expect(humanizeRunDialogFieldLabel('createdAt')).toBe('Created at');
    expect(humanizeRunDialogFieldLabel('assigned_user_ids')).toBe('Assigned users');
    expect(humanizeRunDialogFieldLabel('id')).toBe('Id');
    expect(humanizeRunDialogFieldLabel('externalURLValue')).toBe('External url value');
  });
});

describe('applyDerivedClientScope', () => {
  const contactField = { name: 'contactId', editor: { kind: 'picker' as const, picker: { resource: 'contact' } } };

  it('narrows a contact picker to the client of the chosen ticket', () => {
    const scoped = applyDerivedClientScope(contactField, { ticketId: 't1' }, 'client-1');
    expect(scoped.field.editor?.dependencies).toEqual(['client_id']);
    expect(scoped.rootInputMapping).toEqual({ ticketId: 't1', client_id: 'client-1' });
  });

  it('leaves pickers alone without a known client, for kinds that are not client-scoped, or when already scoped', () => {
    expect(applyDerivedClientScope(contactField, {}, null).field).toBe(contactField);
    const userField = { name: 'actorUserId', editor: { kind: 'picker' as const, picker: { resource: 'user' } } };
    expect(applyDerivedClientScope(userField, {}, 'client-1').field).toBe(userField);
    const declared = { ...contactField, editor: { ...contactField.editor, dependencies: ['client_id'] } };
    expect(applyDerivedClientScope(declared, {}, 'client-1').field).toBe(declared);
  });

  it('keeps a client the form already chose', () => {
    const scoped = applyDerivedClientScope(contactField, { client_id: 'chosen' }, 'client-1');
    expect(scoped.rootInputMapping.client_id).toBe('chosen');
  });
});
