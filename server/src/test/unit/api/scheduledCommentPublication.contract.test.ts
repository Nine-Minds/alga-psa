import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('scheduled client-visible ticket comments', () => {
  it('keeps scheduled rows out of both server-side client read paths before pagination', () => {
    expect(read('../packages/client-portal/src/actions/client-portal-actions/client-tickets.ts')).toContain("'comments.publish_state': 'published'");
    const service = read('src/lib/api/services/TicketService.ts');
    expect(service).toContain(".where('tc.publish_state', 'published')");
    expect(service.indexOf(".where('tc.publish_state', 'published')")).toBeLessThan(service.indexOf('.modify((query) =>'));
  });

  it('uses a conditional scheduled-to-published update as the once-only event gate', () => {
    const handler = read('src/lib/jobs/handlers/publishScheduledCommentHandler.ts');
    expect(handler).toContain("publish_state: 'scheduled'");
    expect(handler).toContain("publish_state: 'published'");
    expect(handler).toContain("eventType: 'TICKET_COMMENT_ADDED'");
  });

  it('forwards scheduling through the optimized MSP ticket composition path', () => {
    const details = read('../packages/tickets/src/components/ticket/TicketDetails.tsx');
    const container = read('../packages/tickets/src/components/ticket/TicketDetailsContainer.tsx');
    const optimized = read('../packages/tickets/src/actions/optimizedTicketActions.ts');

    expect(details).toContain('schedule,');
    expect(container).toContain('undefined,\n        schedule,');
    expect(optimized).toContain("publish_state: 'scheduled'");
    expect(optimized).toContain("SCHEDULED_COMMENT_JOB");
    expect(optimized).toContain('if (!isScheduled)');
  });
});
