import { describe, expect, it } from 'vitest';
import { resolveDeprecatedWorkflowFrom } from '../../../../shared/workflow/runtime/actions/businessOperations/email';

const senders = [
  { sender_id: 'support', email_address: 'support@example.test' },
  { sender_id: 'billing', email_address: 'billing@example.test' },
];

describe('deprecated workflow From compatibility', () => {
  it('maps any configured sender address to its sender id', () => {
    expect(resolveDeprecatedWorkflowFrom({ from: { email: 'billing@example.test' }, senders, effectiveDefaultEmail: 'noreply@example.test' })).toBe('billing');
  });

  it('accepts the effective default address', () => {
    expect(resolveDeprecatedWorkflowFrom({ from: { email: 'noreply@example.test' }, senders, effectiveDefaultEmail: 'noreply@example.test' })).toBeUndefined();
  });

  it('rejects unconfigured addresses', () => {
    expect(() => resolveDeprecatedWorkflowFrom({ from: { email: 'other@example.test' }, senders, effectiveDefaultEmail: 'noreply@example.test' })).toThrow(/configured sender or the effective default/);
  });

  it('rejects conflicts between sender_id and from', () => {
    expect(() => resolveDeprecatedWorkflowFrom({ from: { email: 'billing@example.test' }, senderId: 'support', senders, effectiveDefaultEmail: 'noreply@example.test' })).toThrow(/conflicts/);
  });
});
