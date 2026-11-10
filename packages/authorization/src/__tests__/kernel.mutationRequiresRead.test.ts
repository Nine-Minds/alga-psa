import { describe, expect, it, vi } from 'vitest';

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type AuthorizationSubject,
  type BundleNarrowingRule,
} from '../kernel';
import { prerequisiteActionsFor } from '../kernel/actionAliases';

function subject(userId: string): AuthorizationSubject {
  return { tenant: 'tenant-a', userId, userType: 'internal' };
}

function buildKernel(
  rulesFor: (userId: string) => BundleNarrowingRule[],
  rbacEvaluator: (input: AuthorizationEvaluationInput) => Promise<boolean> = async () => true
) {
  const rbac = vi.fn(rbacEvaluator);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => rulesFor(input.subject.userId),
    }),
    rbacEvaluator: rbac,
  });
  return { kernel, rbac };
}

// The record is assigned to user-a but owned by someone else.
const record = { id: 'ticket-1', ownerUserId: 'someone-else', assignedUserIds: ['user-a'] };
const readOwn: BundleNarrowingRule = { id: 'read-own', resource: 'ticket', action: 'read', templateKey: 'own' };
const readAssigned: BundleNarrowingRule = { id: 'read-assigned', resource: 'ticket', action: 'read', templateKey: 'assigned' };
const updateAssigned: BundleNarrowingRule = { id: 'update-assigned', resource: 'ticket', action: 'update', templateKey: 'assigned' };
const deleteAssigned: BundleNarrowingRule = { id: 'delete-assigned', resource: 'ticket', action: 'delete', templateKey: 'assigned' };

function mutationInput(action: string, userId = 'user-a'): AuthorizationEvaluationInput {
  return { subject: subject(userId), resource: { type: 'ticket', action, id: 'ticket-1' }, record };
}

describe('authorization kernel: update and delete require read', () => {
  it('declares read as the prerequisite of update and delete only', () => {
    expect(prerequisiteActionsFor('update')).toEqual(['read']);
    expect(prerequisiteActionsFor('delete')).toEqual(['read']);
    expect(prerequisiteActionsFor('read')).toEqual([]);
    expect(prerequisiteActionsFor('create')).toEqual([]);
    expect(prerequisiteActionsFor('approve')).toEqual([]);
  });

  it.each(['update', 'delete'])('refuses %s when the update rule matches but the read rule does not', async (action) => {
    const { kernel } = buildKernel(() => [readOwn, updateAssigned]);

    // The update rule on its own allows the record; that is the gap being closed.
    expect((await kernel.authorizeResource(mutationInput(action))).allowed).toBe(true);

    const decision = await kernel.authorizeMutation(mutationInput(action));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContainEqual(
      expect.objectContaining({
        stage: 'mutation',
        code: 'prerequisite_action_denied',
        metadata: { resource: 'ticket', action, requiredAction: 'read' },
      })
    );
    expect(decision.reasons).toContainEqual(expect.objectContaining({ code: 'bundle_template_denied' }));
  });

  it('refuses delete under an exact delete rule when the read rule does not match', async () => {
    const { kernel } = buildKernel(() => [readOwn, deleteAssigned]);
    expect((await kernel.authorizeMutation(mutationInput('delete'))).allowed).toBe(false);
  });

  it.each(['update', 'delete'])('allows %s when the read rule matches as well', async (action) => {
    const { kernel } = buildKernel(() => [readAssigned, updateAssigned]);
    const decision = await kernel.authorizeMutation(mutationInput(action));
    expect(decision.allowed).toBe(true);
    expect(decision.reasons.some((reason) => reason.code === 'prerequisite_action_denied')).toBe(false);
  });

  it('still applies the update rule after read allows', async () => {
    const { kernel } = buildKernel(() => [
      readAssigned,
      { id: 'update-own', resource: 'ticket', action: 'update', templateKey: 'own' },
    ]);
    const decision = await kernel.authorizeMutation(mutationInput('update'));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((reason) => reason.code === 'prerequisite_action_denied')).toBe(false);
  });

  it('leaves an action with no prerequisite alone', async () => {
    const { kernel } = buildKernel(() => [
      readOwn,
      { id: 'approve-assigned', resource: 'ticket', action: 'approve', templateKey: 'assigned' },
    ]);
    expect((await kernel.authorizeMutation(mutationInput('approve'))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(mutationInput('create'))).allowed).toBe(true);
  });

  it('is unchanged for a subject with no rules', async () => {
    const { kernel } = buildKernel(() => []);
    expect((await kernel.authorizeMutation(mutationInput('update'))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(mutationInput('delete'))).allowed).toBe(true);
  });

  it('asks RBAC only for the requested action, never for read', async () => {
    const { kernel, rbac } = buildKernel(
      () => [],
      async (input) => input.resource.action === 'update'
    );
    expect((await kernel.authorizeMutation(mutationInput('update'))).allowed).toBe(true);
    expect(rbac.mock.calls.map(([input]) => input.resource.action)).toEqual(['update']);
  });

  it('does not let a read rule that only redacts fields refuse the mutation', async () => {
    const { kernel } = buildKernel(() => [
      { id: 'read-redact', resource: 'ticket', action: 'read', redactedFields: ['description'] },
      updateAssigned,
    ]);
    expect((await kernel.authorizeMutation(mutationInput('update'))).allowed).toBe(true);
  });

  it('does not evaluate a relationship template when no record is supplied', async () => {
    const { kernel } = buildKernel(() => [readOwn, updateAssigned]);
    const { record: _record, ...withoutRecord } = mutationInput('update');
    expect((await kernel.authorizeMutation(withoutRecord)).allowed).toBe(true);
  });

  it('requires read of each subject on a joint evaluation', async () => {
    // user-a reads and updates assigned records; user-b may update them but reads only its own.
    const { kernel } = buildKernel((userId) =>
      userId === 'user-b' ? [readOwn, updateAssigned] : [readAssigned, updateAssigned]
    );
    const sharedRecord = { id: 'ticket-1', ownerUserId: 'someone-else', assignedUserIds: ['user-a', 'user-b'] };
    const input: AuthorizationEvaluationInput = {
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource: { type: 'ticket', action: 'update', id: 'ticket-1' },
      record: sharedRecord,
    };

    const decision = await kernel.authorizeMutation(input);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContainEqual(
      expect.objectContaining({ code: 'prerequisite_action_denied', subjectUserId: 'user-b' })
    );
    expect(
      decision.reasons.some((reason) => reason.code === 'prerequisite_action_denied' && reason.subjectUserId === 'user-a')
    ).toBe(false);

    const alone = await kernel.authorizeMutation({ ...input, jointSubject: undefined });
    expect(alone.allowed).toBe(true);
  });
});
