import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDocument, IUser } from '@alga-psa/types';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  documents: [] as Array<Record<string, unknown>>,
  authorize: vi.fn(),
  admission: vi.fn(),
  assertCurrent: vi.fn(),
  identify: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => ({
    table: () => {
      const predicates = [(row: Record<string, unknown>) => row.tenant === tenant];
      const query = {
        modify: (apply: (query: unknown) => void) => { apply(query); return query; },
        where: (column: string, value: unknown) => {
          predicates.push(row => row[column] === value);
          return query;
        },
        first: async () => state.documents.find(row => predicates.every(predicate => predicate(row))),
      };
      return query;
    },
  }),
}));

// Model the product predicate as a row property to exercise its place in the
// access pipeline without a database.
vi.mock('../documentProductReadScope', () => ({
  applyDocumentProductReadScope: (query: Knex.QueryBuilder) => query.where('product_readable', true),
}));
vi.mock('../documentAuthorization', () => ({
  authorizeAndRedactDocumentsForAction: state.authorize,
}));
vi.mock('@alga-psa/core/capability', () => ({ serves: async () => ({ served: true }) }));

import { getAuthorizedDocumentById, loadAuthorizedDocumentById } from '../documentAccess';
import { meetingDocumentsSeam } from '../meetingDocumentAdmission';

const user = { tenant: 'tenant-a', user_id: 'user-a', user_type: 'internal' } as IUser;
const trx = {} as Knex.Transaction;

beforeEach(() => {
  vi.resetAllMocks();
  state.documents = [
    { tenant: 'tenant-a', document_id: 'readable', product_readable: true, content: 'private content' },
    { tenant: 'tenant-b', document_id: 'other-tenant', product_readable: true, content: 'other tenant content' },
    { tenant: 'tenant-a', document_id: 'other-product', product_readable: false, content: 'other product content' },
  ];
  state.identify.mockResolvedValue({ kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a' });
  state.authorize.mockImplementation(async (_trx, _tenant, _user, documents: IDocument[]) => documents);
  state.admission.mockImplementation(async (_trx, _tenant, _ids, identify) => {
    await identify();
    return { handled: true, deniedDocumentIds: [], assertCurrent: state.assertCurrent };
  });
  meetingDocumentsSeam.reset();
  meetingDocumentsSeam.register(() => ({ admitMeetingDocuments: state.admission }));
});

afterEach(() => { meetingDocumentsSeam.reset(); });

describe('shared document access', () => {
  it('returns the authorized projection after meeting credentials have been rechecked', async () => {
    state.authorize.mockImplementation(async (_trx, _tenant, _user, documents: Array<IDocument & { content?: string }>) =>
      documents.map(({ content: _content, ...document }) => document));

    const document = await getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify);

    expect(document).toMatchObject({ document_id: 'readable' });
    expect(document).not.toHaveProperty('content');
    expect(state.authorize).toHaveBeenCalledWith(trx, 'tenant-a', user, [state.documents[0]], 'read', undefined);
    expect(state.assertCurrent).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'other-tenant', 'other-product'])('does not admit or authorize an inaccessible row: %s', async (id) => {
    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, id, state.identify)).resolves.toBeNull();
    expect(state.admission).not.toHaveBeenCalled();
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.identify).not.toHaveBeenCalled();
  });

  it('admits the document using credentials supplied by its caller', async () => {
    state.identify.mockResolvedValue({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'caller-session',
    });
    state.admission.mockImplementation(async (_trx, _tenant, ids, identify) => ({
      handled: true,
      deniedDocumentIds: (await identify()).sessionId === 'caller-session' ? [] : ids,
    }));

    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify))
      .resolves.toMatchObject({ document_id: 'readable' });
  });

  it('does not resolve browser credentials when the provider does not need them', async () => {
    state.admission.mockResolvedValue({ handled: true, deniedDocumentIds: [] });
    state.identify.mockRejectedValue(new Error('No browser request in this runtime'));

    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify))
      .resolves.toMatchObject({ document_id: 'readable' });
    expect(state.identify).not.toHaveBeenCalled();
  });

  it('rejects failed identity resolution before relationship authorization', async () => {
    state.identify.mockRejectedValue(new Error('Browser credential rejected'));

    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify))
      .rejects.toThrow('Browser credential rejected');
    expect(state.authorize).not.toHaveBeenCalled();
  });

  it('cannot widen a meeting admission denial through the relationship authorizer', async () => {
    state.admission.mockResolvedValue({ handled: true, deniedDocumentIds: ['readable'], assertCurrent: state.assertCurrent });

    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify)).resolves.toBeNull();
    expect(state.authorize).toHaveBeenCalledWith(trx, 'tenant-a', user, [], 'read', undefined);
    expect(state.assertCurrent).toHaveBeenCalledOnce();
  });

  it('cannot widen a relationship denial through meeting admission', async () => {
    state.authorize.mockResolvedValue([]);
    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify)).resolves.toBeNull();
  });

  it('rejects a credential revoked during relationship authorization', async () => {
    let revoked = false;
    state.authorize.mockImplementation(async (_trx, _tenant, _user, documents: IDocument[]) => {
      revoked = true;
      return documents;
    });
    state.assertCurrent.mockImplementation(async () => {
      if (revoked) throw new Error('Session revoked');
    });

    await expect(getAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', state.identify)).rejects.toThrow('Session revoked');
  });

  it.each(['update', 'delete'] as const)('uses the mutation policy for %s', async action => {
    state.authorize.mockImplementation(async (_trx, _tenant, _user, _documents, operation) =>
      operation === 'read' ? state.documents : []);

    await expect(loadAuthorizedDocumentById(trx, 'tenant-a', user, 'readable', action, state.identify)).resolves.toBeNull();
    expect(state.authorize).toHaveBeenCalledWith(trx, 'tenant-a', user, [state.documents[0]], action, undefined);
  });
});
