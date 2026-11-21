import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();
const assertCanActOnBehalfMock = vi.fn();
const assertCanApproveSubjectMock = vi.fn();
const delegateToTimeSourceMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => action,
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: () => scopedDb,
}));

vi.mock('../src/actions/timeEntryDelegationAuth', () => ({
  assertCanActOnBehalf: (...args: any[]) => assertCanActOnBehalfMock(...args),
  assertCanApproveSubject: (...args: any[]) => assertCanApproveSubjectMock(...args),
  resolveManagedSubjectUserIds: vi.fn(),
}));

vi.mock('../src/lib/timeSource', () => ({
  delegateToTimeSource: (...args: any[]) => delegateToTimeSourceMock(...args),
}));

let sheet: { id: string; user_id: string };
let insertedValues: Record<string, unknown> | undefined;
let scopedDb: any;
let db: any;

const actor = { user_id: 'authenticated-user', user_type: 'internal', clientId: null };

describe('addCommentToTimeSheet authorization and attribution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sheet = { id: 'sheet-1', user_id: 'owner-1' };
    insertedValues = undefined;
    const inserted = {
      comment_id: 'comment-1',
      time_sheet_id: 'sheet-1',
      user_id: 'authenticated-user',
      comment: 'hello',
      is_approver: false,
      tenant: 'tenant-1',
      created_at: new Date('2026-11-02T12:00:00.000Z'),
    };
    db = Object.assign(vi.fn(), { fn: { now: () => 'NOW' } });
    scopedDb = {
      table: (table: string) => {
        if (table === 'time_sheets') {
          const query: any = { where: () => query, first: async () => sheet };
          return query;
        }
        if (table === 'time_sheet_comments') {
          return {
            insert: (values: Record<string, unknown>) => {
              insertedValues = values;
              return { returning: async () => [inserted] };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    createTenantKnexMock.mockResolvedValue({ knex: db });
    hasPermissionMock.mockResolvedValue(true);
    assertCanActOnBehalfMock.mockResolvedValue('manager');
    assertCanApproveSubjectMock.mockResolvedValue('manager');
    delegateToTimeSourceMock.mockResolvedValue({ handled: false });
  });

  async function action() {
    return (await import('../src/actions/timeSheetActions')).addCommentToTimeSheet;
  }

  it('stores owner attribution and ignores forged legacy identity and approver arguments', async () => {
    sheet.user_id = actor.user_id;
    const addComment = await action();

    await (addComment as any) (actor, { tenant: 'tenant-1' }, 'sheet-1', 'hello', 'forged-user', true);

    expect(insertedValues).toMatchObject({ user_id: actor.user_id, is_approver: false, comment: 'hello' });
    expect(assertCanApproveSubjectMock).not.toHaveBeenCalled();
  });

  it('labels an authorized delegated approver and still records the authenticated actor', async () => {
    const addComment = await action();

    await addComment(actor as any, { tenant: 'tenant-1' }, 'sheet-1', 'hello');

    expect(assertCanActOnBehalfMock).toHaveBeenCalledWith(actor, 'tenant-1', 'owner-1', db);
    expect(assertCanApproveSubjectMock).toHaveBeenCalledWith(actor, 'tenant-1', 'owner-1', db);
    expect(insertedValues).toMatchObject({ user_id: actor.user_id, is_approver: true });
  });

  it('does not label a comment approver when delegated comment access lacks approval authority', async () => {
    assertCanApproveSubjectMock.mockRejectedValue(new Error('Permission denied: Cannot approve time submissions'));
    const addComment = await action();

    await (addComment as any)(actor, { tenant: 'tenant-1' }, 'sheet-1', 'hello', 'forged-user', true);

    expect(insertedValues).toMatchObject({ user_id: actor.user_id, is_approver: false });
  });

  it('passes the server-built commenter to an owning time source', async () => {
    const sourceComment = vi.fn(async (_ctx: unknown, _id: string, _comment: string, commenter: unknown) => ({
      handled: true as const,
      value: commenter,
    }));
    const providerSheet = { user_id: 'owner-1' };
    const commentSubject = vi.fn(async () => ({ handled: true as const, value: providerSheet }));
    delegateToTimeSourceMock.mockImplementation(async (_ctx, call) =>
      call({ sheets: { commentSubject, comment: sourceComment } }, { tenant: 'tenant-1' }),
    );
    const addComment = await action();

    const result = await (addComment as any)(actor, { tenant: 'tenant-1' }, 'sheet-1', 'hello', 'forged-user', true);

    expect(sourceComment).toHaveBeenCalledWith(
      { tenant: 'tenant-1' },
      'sheet-1',
      'hello',
      { user_id: actor.user_id, is_approver: true },
    );
    expect(result).toEqual({ user_id: actor.user_id, is_approver: true });
    expect(commentSubject).toHaveBeenCalledWith({ tenant: 'tenant-1' }, 'sheet-1');
    expect(insertedValues).toBeUndefined();
  });

  it('comments on a provider-owned sheet with no native row using server-derived owner attribution', async () => {
    const providerComment = vi.fn(async (_ctx: unknown, _id: string, _comment: string, commenter: unknown) => ({
      handled: true as const,
      value: commenter,
    }));
    const commentSubject = vi.fn(async () => ({ handled: true as const, value: { user_id: actor.user_id } }));
    const nativeSheetLookup = vi.fn(async () => undefined);
    scopedDb.table = (table: string) => {
      if (table === 'time_sheets') return { where: () => ({ first: nativeSheetLookup }) };
      if (table === 'time_sheet_comments') throw new Error('provider comment must not write natively');
      throw new Error(`Unexpected table ${table}`);
    };
    delegateToTimeSourceMock.mockImplementation(async (_ctx, call) =>
      call({ sheets: { commentSubject, comment: providerComment } }, { tenant: 'tenant-1' }),
    );
    const addComment = await action();

    const result = await addComment(actor as any, { tenant: 'tenant-1' }, 'sheet-1', 'hello');

    expect(result).toEqual({ user_id: actor.user_id, is_approver: false });
    expect(nativeSheetLookup).not.toHaveBeenCalled();
    expect(assertCanApproveSubjectMock).not.toHaveBeenCalled();
    expect(providerComment).toHaveBeenCalledWith(
      { tenant: 'tenant-1' }, 'sheet-1', 'hello',
      { user_id: actor.user_id, is_approver: false },
    );
  });

  it('blocks provider writes when delegated authorization is denied', async () => {
    const providerComment = vi.fn(async () => ({ handled: true as const, value: null }));
    const commentSubject = vi.fn(async () => ({ handled: true as const, value: { user_id: 'owner-1' } }));
    delegateToTimeSourceMock.mockImplementation(async (_ctx, call) =>
      call({ sheets: { commentSubject, comment: providerComment } }, { tenant: 'tenant-1' }),
    );
    assertCanActOnBehalfMock.mockRejectedValue(new Error('Permission denied: Cannot access other users time sheets'));
    const addComment = await action();

    await expect(addComment(actor as any, { tenant: 'tenant-1' }, 'sheet-1', 'hello')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access other users time sheets',
    });
    expect(providerComment).not.toHaveBeenCalled();
    expect(insertedValues).toBeUndefined();
  });

  it('denies a non-owner without permission before persisting a comment', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const addComment = await action();

    await expect(addComment(actor as any, { tenant: 'tenant-1' }, 'sheet-1', 'hello')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot add comments to timesheets',
    });
    expect(insertedValues).toBeUndefined();
  });
});
