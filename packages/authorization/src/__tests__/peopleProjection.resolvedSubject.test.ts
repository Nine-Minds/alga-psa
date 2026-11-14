import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { AuthorizationSubject } from '../kernel/contracts';
import {
  projectPeopleForSubject,
  registerSubjectPeopleProjector,
  unregisterSubjectPeopleProjector,
  type ProjectedPerson,
} from '../subject/peopleProjection';

const RESOLVER_ID = 'test-people-projection';

/** A connection that fails the test if anything is asked of it. */
const noStatements = new Proxy(() => undefined, {
  get: () => { throw new Error('projectPeopleForSubject issued a statement'); },
  apply: () => { throw new Error('projectPeopleForSubject issued a statement'); },
}) as unknown as Knex;

const subject = (resolverFacts?: Record<string, unknown>) =>
  ({ tenant: 't1', userId: 'u1', resolverFacts }) as unknown as AuthorizationSubject;

describe('projectPeopleForSubject (a caller that already holds the resolved subject)', () => {
  afterEach(() => unregisterSubjectPeopleProjector(RESOLVER_ID));

  const register = () => {
    const people = vi.fn(async (): Promise<ProjectedPerson[]> => [
      { kind: 'msp_staff', userId: 's1', contactId: null, displayName: 'Sierra Staff' },
    ]);
    registerSubjectPeopleProjector({
      resolverId: RESOLVER_ID,
      appliesTo: (candidate) => Boolean(candidate.resolverFacts?.[RESOLVER_ID]),
      people,
    });
    return people;
  };

  it('answers null for a subject no projector claims, without a statement', async () => {
    const people = register();
    await expect(projectPeopleForSubject(noStatements, subject())).resolves.toBeNull();
    expect(people).not.toHaveBeenCalled();
  });

  it('answers the claiming projector for a member subject, passing the subject and query through', async () => {
    const people = register();
    const member = subject({ [RESOLVER_ID]: { scope: true } });
    await expect(projectPeopleForSubject(noStatements, member, { kinds: ['msp_staff'] }))
      .resolves.toEqual([{ kind: 'msp_staff', userId: 's1', contactId: null, displayName: 'Sierra Staff' }]);
    expect(people).toHaveBeenCalledTimes(1);
    const [connection, passedSubject, query] = people.mock.calls[0] as unknown as [unknown, unknown, unknown];
    expect(connection === noStatements).toBe(true);
    expect(passedSubject).toBe(member);
    expect(query).toEqual({ kinds: ['msp_staff'] });
  });
});
