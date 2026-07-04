import { describe, expect, it, vi } from 'vitest';

import { aclPredicateSql, verifyResultVisibility } from '@alga-psa/search/acl';

describe('search ACL SQL predicate', () => {
  it('T105 filters required_permission through the user permission set', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain(
      '(required_permission IS NULL OR required_permission = ANY(?::text[]))',
    );
    expect(fragment.bindings[0]).toEqual(['client:read']);
    expect(fragment.bindings[0]).not.toContain('ticket:read');
  });

  it('T107 requires visible_to_user_ids overlap when the row has a user restriction', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const fragment = aclPredicateSql({
      userId,
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain(
      '(cardinality(visible_to_user_ids) = 0 OR visible_to_user_ids && ARRAY[?]::uuid[])',
    );
    expect(fragment.bindings[1]).toBe(userId);
  });

  it('T108 allows rows with empty visible_to_user_ids for users with required permission', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain('required_permission = ANY(?::text[])');
    expect(fragment.sql).toContain('cardinality(visible_to_user_ids) = 0 OR');
    expect(fragment.bindings[0]).toEqual(['client:read']);
  });

  it('T109 hides internal-only rows from client-type users', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['ticket:read'],
      isInternal: false,
    });

    expect(fragment.sql).toContain('(is_internal_only = false OR ?::boolean = true)');
    expect(fragment.bindings[3]).toBe(false);
  });

  it('T110 hides private rows unless the user is in visible_to_user_ids', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const fragment = aclPredicateSql({
      userId,
      permissions: ['document:read'],
    });

    expect(fragment.sql).toContain(
      '(is_private = false OR visible_to_user_ids && ARRAY[?]::uuid[])',
    );
    expect(fragment.bindings[4]).toBe(userId);
  });

  it('T111 filters client_scope_id through scoped client access', () => {
    const clientIds = ['10000000-0000-0000-0000-000000000001'];
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['document:read'],
      clientAccess: { mode: 'scoped', clientIds },
    });

    expect(fragment.sql).toContain('(client_scope_id IS NULL OR client_scope_id = ANY(?::uuid[]))');
    expect(fragment.bindings[5]).toEqual(clientIds);
  });

  it('T111b bypasses the client_scope_id predicate for unrestricted (mode: all) principals', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['document:read'],
      clientAccess: { mode: 'all' },
    });

    expect(fragment.sql).not.toContain('client_scope_id = ANY(?::uuid[])');
    expect(fragment.sql).toContain('AND TRUE');
    // No client array bound — only the 5 fixed ACL bindings.
    expect(fragment.bindings).toHaveLength(5);
  });

  it('T112 drops rows rejected by the record-level verifier', async () => {
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      first: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      then: (
        resolve: (row: undefined) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('tickets');
      return query;
    });

    const visible = await verifyResultVisibility(
      knex as never,
      {
        userId: '00000000-0000-0000-0000-000000000001',
        tenant: 'tenant-1',
        permissions: ['ticket:read'],
        isInternal: true,
      },
      [{ type: 'ticket', id: 'ticket-missing' }],
    );

    expect(query.where).toHaveBeenCalledWith('tickets.tenant', 'tenant-1');
    expect(query.where).toHaveBeenCalledWith('ticket_id', 'ticket-missing');
    expect(visible).toEqual([]);
  });

  it('T113 emits search.acl_drift telemetry when record-level visibility rejects a row', async () => {
    const captureMessage = vi.fn();
    const previousSentry = (globalThis as { Sentry?: unknown }).Sentry;
    (globalThis as { Sentry?: unknown }).Sentry = { captureMessage };
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      first: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      then: (
        resolve: (row: undefined) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    const knex = vi.fn(() => query);

    try {
      await verifyResultVisibility(
        knex as never,
        {
          userId: '00000000-0000-0000-0000-000000000001',
          tenant: 'tenant-1',
          permissions: ['ticket:read'],
          isInternal: true,
        },
        [{ type: 'ticket', id: 'ticket-missing' }],
      );

      expect(captureMessage).toHaveBeenCalledWith(
        'search.acl_drift',
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({
            metric: 'search.acl_drift',
            objectType: 'ticket',
            objectId: 'ticket-missing',
          }),
        }),
      );
    } finally {
      (globalThis as { Sentry?: unknown }).Sentry = previousSentry;
    }
  });

  it('T114 keeps rows and emits no drift when record-level visibility agrees', async () => {
    const captureMessage = vi.fn();
    const previousSentry = (globalThis as { Sentry?: unknown }).Sentry;
    (globalThis as { Sentry?: unknown }).Sentry = { captureMessage };
    const ticketRow = { ticket_id: 'ticket-1' };
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      first: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      then: (
        resolve: (row: typeof ticketRow) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(ticketRow).then(resolve, reject),
    };
    const knex = vi.fn(() => query);
    const rows = [{ type: 'ticket' as const, id: 'ticket-1' }];

    try {
      await expect(verifyResultVisibility(
        knex as never,
        {
          userId: '00000000-0000-0000-0000-000000000001',
          tenant: 'tenant-1',
          permissions: ['ticket:read'],
          isInternal: true,
        },
        rows,
      )).resolves.toEqual(rows);

      expect(captureMessage).not.toHaveBeenCalled();
    } finally {
      (globalThis as { Sentry?: unknown }).Sentry = previousSentry;
    }
  });

  it('T165 keeps internal ticket-comment hits visible for internal users', async () => {
    const makeQuery = <TRow,>(row: TRow) => {
      const query = {
        select: vi.fn(() => query),
        where: vi.fn(() => query),
        first: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        then: (
          resolve: (value: TRow) => unknown,
          reject: (reason?: unknown) => unknown,
        ) => Promise.resolve(row).then(resolve, reject),
      };
      return query;
    };
    const commentQuery = makeQuery({ ticket_id: 'ticket-1', is_internal: true });
    const ticketQuery = makeQuery({ ticket_id: 'ticket-1' });
    const knex = vi.fn((table: string) => {
      if (table === 'comments') return commentQuery;
      if (table === 'tickets') return ticketQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    const rows = [{ type: 'ticket_comment' as const, id: 'comment-1' }];

    await expect(verifyResultVisibility(
      knex as never,
      {
        userId: '00000000-0000-0000-0000-000000000001',
        tenant: 'tenant-1',
        permissions: ['ticket:read'],
        isInternal: true,
      },
      rows,
    )).resolves.toEqual(rows);

    expect(commentQuery.where).toHaveBeenCalledWith('comment_id', 'comment-1');
    expect(ticketQuery.where).toHaveBeenCalledWith('ticket_id', 'ticket-1');
  });

  it('T166 drops internal ticket-comment hits for non-internal users', async () => {
    const commentQuery = {
      select: vi.fn(() => commentQuery),
      where: vi.fn(() => commentQuery),
      first: vi.fn(() => commentQuery),
      andWhere: vi.fn(() => commentQuery),
      then: (
        resolve: (value: { ticket_id: string; is_internal: boolean }) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve({ ticket_id: 'ticket-1', is_internal: true }).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      if (table === 'comments') return commentQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(verifyResultVisibility(
      knex as never,
      {
        userId: '00000000-0000-0000-0000-000000000002',
        tenant: 'tenant-1',
        permissions: ['ticket:read'],
        isInternal: false,
      },
      [{ type: 'ticket_comment' as const, id: 'comment-1' }],
    )).resolves.toEqual([]);

    expect(commentQuery.where).toHaveBeenCalledWith('comment_id', 'comment-1');
    expect(knex).not.toHaveBeenCalledWith('tickets');
  });

  it('T167 drops project hits outside the user accessible client scope', async () => {
    const projectQuery = {
      select: vi.fn(() => projectQuery),
      where: vi.fn(() => projectQuery),
      first: vi.fn(() => projectQuery),
      andWhere: vi.fn(() => projectQuery),
      then: (
        resolve: (value: { client_id: string }) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve({ client_id: 'client-x' }).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('projects');
      return projectQuery;
    });

    await expect(verifyResultVisibility(
      knex as never,
      {
        userId: '00000000-0000-0000-0000-000000000001',
        tenant: 'tenant-1',
        permissions: ['project:read'],
        isInternal: true,
        clientAccess: { mode: 'scoped', clientIds: ['client-a'] },
      },
      [{ type: 'project' as const, id: 'project-1' }],
    )).resolves.toEqual([]);

    expect(projectQuery.where).toHaveBeenCalledWith('projects.tenant', 'tenant-1');
    expect(projectQuery.where).toHaveBeenCalledWith('project_id', 'project-1');
  });

  it('T168 drops document hits outside the user accessible client scope', async () => {
    const makeQuery = <TRow,>(row: TRow) => {
      const query = {
        select: vi.fn(() => query),
        where: vi.fn(() => query),
        first: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        then: (
          resolve: (value: TRow) => unknown,
          reject: (reason?: unknown) => unknown,
        ) => Promise.resolve(row).then(resolve, reject),
      };
      return query;
    };
    const documentQuery = makeQuery({ document_id: 'document-1' });
    const associationQuery = makeQuery({ entity_id: 'client-x' });
    const knex = vi.fn((table: string) => {
      if (table === 'documents') return documentQuery;
      if (table === 'document_associations') return associationQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(verifyResultVisibility(
      knex as never,
      {
        userId: '00000000-0000-0000-0000-000000000001',
        tenant: 'tenant-1',
        permissions: ['document:read'],
        isInternal: true,
        clientAccess: { mode: 'scoped', clientIds: ['client-a'] },
      },
      [{ type: 'document' as const, id: 'document-1' }],
    )).resolves.toEqual([]);

    expect(documentQuery.where).toHaveBeenCalledWith('documents.tenant', 'tenant-1');
    expect(documentQuery.where).toHaveBeenCalledWith('document_id', 'document-1');
    expect(associationQuery.where).toHaveBeenCalledWith('document_associations.tenant', 'tenant-1');
    expect(associationQuery.andWhere).toHaveBeenCalledWith('entity_type', 'client');
  });

  it('T194 emits zero acl_drift for rows whose SQL and record-level ACL agree', async () => {
    const captureMessage = vi.fn();
    const previousSentry = (globalThis as { Sentry?: unknown }).Sentry;
    (globalThis as { Sentry?: unknown }).Sentry = { captureMessage };
    const makeQuery = <TRow,>(row: TRow) => {
      const query = {
        select: vi.fn(() => query),
        where: vi.fn(() => query),
        first: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        then: (
          resolve: (value: TRow) => unknown,
          reject: (reason?: unknown) => unknown,
        ) => Promise.resolve(row).then(resolve, reject),
      };
      return query;
    };
    const ticketQuery = makeQuery({ ticket_id: 'ticket-1' });
    const documentQuery = makeQuery({ document_id: 'document-1' });
    const associationQuery = makeQuery({ entity_id: 'client-1' });
    const knex = vi.fn((table: string) => {
      if (table === 'tickets') return ticketQuery;
      if (table === 'documents') return documentQuery;
      if (table === 'document_associations') return associationQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    const rows = [
      { type: 'ticket' as const, id: 'ticket-1' },
      { type: 'document' as const, id: 'document-1' },
    ];

    try {
      await expect(verifyResultVisibility(
        knex as never,
        {
          userId: '00000000-0000-0000-0000-000000000001',
          tenant: 'tenant-1',
          permissions: ['ticket:read', 'document:read'],
          isInternal: true,
          clientAccess: { mode: 'scoped', clientIds: ['client-1'] },
        },
        rows,
      )).resolves.toEqual(rows);

      expect(captureMessage).not.toHaveBeenCalled();
    } finally {
      (globalThis as { Sentry?: unknown }).Sentry = previousSentry;
    }
  });
});
