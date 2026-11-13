import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ticket email inline image observability contract', () => {
  it('T031: logs per-image CID conversion vs URL fallback outcomes', () => {
    const filePath = path.resolve(
      __dirname,
      '../../../lib/notifications/ticketRichTextEmail.ts'
    );
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('for (const outcome of rewritten.outcomes)');
    expect(source).toContain('[TicketEmailSubscriber] Comment inline image processing outcome');
    expect(source).toContain('logger.info(message, {');
    expect(source).toContain('strategy: outcome.strategy');
    expect(source).toContain('reason: outcome.reason');
  });
});
