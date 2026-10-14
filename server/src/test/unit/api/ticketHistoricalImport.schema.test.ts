import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTicketCommentSchema,
  createTicketRequestSchema,
  createTicketSchema,
  updateTicketSchema,
  updateTicketStatusSchema,
} from '../../../lib/api/schemas/ticket';

const UUID = {
  board: '11111111-1111-4111-8111-111111111111',
  client: '22222222-2222-4222-8222-222222222222',
  status: '33333333-3333-4333-8333-333333333333',
  priority: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
  parent: '66666666-6666-4666-8666-666666666666',
};

const BASE_TICKET = {
  title: 'Imported ticket',
  board_id: UUID.board,
  client_id: UUID.client,
  status_id: UUID.status,
  priority_id: UUID.priority,
};

const NOW = new Date('2026-10-12T12:00:00.000Z');

describe('historical import schemas (alga-2026-0002678)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createTicketRequestSchema', () => {
    it('accepts an offset ISO entered_at and keeps it on the parsed output', () => {
      const parsed = createTicketRequestSchema.parse({ ...BASE_TICKET, entered_at: '2026-04-12T09:30:00+02:00' });
      expect(parsed.entered_at).toBe('2026-04-12T09:30:00+02:00');
    });

    it('accepts Z-suffixed entered_at together with closed_at and closed_by', () => {
      const parsed = createTicketRequestSchema.parse({
        ...BASE_TICKET,
        entered_at: '2026-01-01T00:00:00Z',
        closed_at: '2026-01-02T00:00:00Z',
        closed_by: UUID.user,
      });
      expect(parsed.closed_at).toBe('2026-01-02T00:00:00Z');
      expect(parsed.closed_by).toBe(UUID.user);
    });

    it('still accepts a request without entered_at (normal live create)', () => {
      expect(createTicketRequestSchema.safeParse(BASE_TICKET).success).toBe(true);
    });

    it.each(['2026-04-12', 'yesterday', '2026-04-12 09:30:00', '2026-04-12T09:30:00'])(
      'rejects the badly formatted entered_at %s',
      (value) => {
        const result = createTicketRequestSchema.safeParse({ ...BASE_TICKET, entered_at: value });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].path).toEqual(['entered_at']);
      },
    );

    it('rejects a future entered_at with the field path', () => {
      const result = createTicketRequestSchema.safeParse({ ...BASE_TICKET, entered_at: '2026-10-12T12:00:01Z' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['entered_at']);
        expect(result.error.issues[0].message).toContain('future');
      }
    });

    it('rejects closed_at and closed_by without entered_at', () => {
      const result = createTicketRequestSchema.safeParse({
        ...BASE_TICKET,
        closed_at: '2026-01-02T00:00:00Z',
        closed_by: UUID.user,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path[0]).sort()).toEqual(['closed_at', 'closed_by']);
      }
    });

    it('rejects closed_by without closed_at', () => {
      const result = createTicketRequestSchema.safeParse({
        ...BASE_TICKET,
        entered_at: '2026-01-01T00:00:00Z',
        closed_by: UUID.user,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['closed_by']);
    });

    it('rejects closed_at before entered_at', () => {
      const result = createTicketRequestSchema.safeParse({
        ...BASE_TICKET,
        entered_at: '2026-01-02T00:00:00Z',
        closed_at: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['closed_at']);
        expect(result.error.issues[0].message).toContain('before entered_at');
      }
    });

    it('rejects a future closed_at', () => {
      const result = createTicketRequestSchema.safeParse({
        ...BASE_TICKET,
        entered_at: '2026-01-02T00:00:00Z',
        closed_at: '2026-11-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['closed_at']);
    });

    it('keeps createTicketSchema a plain object so updateTicketSchema can derive from it', () => {
      expect(typeof (createTicketSchema as any).omit).toBe('function');
      expect(typeof (createTicketSchema as any).shape).toBe('object');
    });
  });

  describe('updateTicketSchema (create-only fields)', () => {
    it('strips entered_at, closed_at and closed_by', () => {
      const parsed = updateTicketSchema.parse({
        title: 'Renamed',
        entered_at: '2026-01-01T00:00:00Z',
        closed_at: '2026-01-02T00:00:00Z',
        closed_by: UUID.user,
      }) as Record<string, unknown>;
      expect(parsed.title).toBe('Renamed');
      expect(parsed).not.toHaveProperty('entered_at');
      expect(parsed).not.toHaveProperty('closed_at');
      expect(parsed).not.toHaveProperty('closed_by');
    });
  });

  describe('updateTicketStatusSchema.closed_at', () => {
    it('accepts a past closed_at', () => {
      expect(
        updateTicketStatusSchema.parse({ status_id: UUID.status, closed_at: '2026-01-02T00:00:00Z' }).closed_at,
      ).toBe('2026-01-02T00:00:00Z');
    });

    it('rejects a future closed_at', () => {
      const result = updateTicketStatusSchema.safeParse({ status_id: UUID.status, closed_at: '2026-12-01T00:00:00Z' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['closed_at']);
    });
  });

  describe('createTicketCommentSchema.created_at', () => {
    const base = { comment_text: 'Historic note' };

    it('accepts an offset ISO created_at', () => {
      expect(createTicketCommentSchema.parse({ ...base, created_at: '2026-03-01T10:00:00-05:00' }).created_at).toBe(
        '2026-03-01T10:00:00-05:00',
      );
    });

    it.each(['2026-03-01', 'not-a-date', '2026-03-01T10:00:00'])('rejects the badly formatted created_at %s', (value) => {
      const result = createTicketCommentSchema.safeParse({ ...base, created_at: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['created_at']);
    });

    it('rejects a future created_at', () => {
      const result = createTicketCommentSchema.safeParse({ ...base, created_at: '2026-10-13T00:00:00Z' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toContain('future');
    });

    it('rejects created_at together with scheduled publication', () => {
      const result = createTicketCommentSchema.safeParse({
        ...base,
        created_at: '2026-03-01T10:00:00Z',
        scheduled_publish_at: '2026-11-01T10:00:00Z',
        scheduled_publish_tz: 'UTC',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path[0])).toContain('scheduled_publish_at');
      }
    });

    it.each(['cc', 'bcc'] as const)('rejects created_at together with %s', (field) => {
      const result = createTicketCommentSchema.safeParse({
        ...base,
        created_at: '2026-03-01T10:00:00Z',
        [field]: ['someone@example.com'],
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path[0])).toContain(field);
    });

    it('still accepts cc without created_at', () => {
      expect(createTicketCommentSchema.safeParse({ ...base, cc: ['someone@example.com'] }).success).toBe(true);
    });

    it('accepts created_at on a threaded reply', () => {
      expect(
        createTicketCommentSchema.safeParse({ ...base, created_at: '2026-03-01T10:00:00Z', parent_comment_id: UUID.parent })
          .success,
      ).toBe(true);
    });
  });
});
