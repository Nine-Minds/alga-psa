// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextTemplateTitle, renderTitleTemplate, toCalendarDate } from '../lib/ticketTitleTokens';

// These are the exact functions QuickAddTicket uses (templateTitleContext -> nextTemplateTitle in its
// re-render effect, renderTitleTemplate on template apply), so the tests run the component's code path.

const RAW = 'Dept change at {{client}}, due {{due_date}} ({{month}} {{year}})';

function context(dueDate: Date | undefined) {
  return { clientName: 'Cool Cars', contactName: null, dueDate: dueDate ? toCalendarDate(dueDate) : null };
}

describe('Quick Add template title with a due date', () => {
  const initial = renderTitleTemplate(RAW, context(undefined));

  it('(a) renders due_date, month and year when a date is set on an untouched title', () => {
    const next = nextTemplateTitle(RAW, context(new Date(2026, 9, 26)), initial, initial);
    expect(next).toBe('Dept change at Cool Cars, due October 26, 2026 (October 2026)');
  });

  it('(b) re-renders when the date changes', () => {
    const first = nextTemplateTitle(RAW, context(new Date(2026, 9, 26)), initial, initial)!;
    const second = nextTemplateTitle(RAW, context(new Date(2027, 0, 5)), first, first);
    expect(second).toBe('Dept change at Cool Cars, due January 5, 2027 (January 2027)');
  });

  it('(c) clearing the date renders the tokens blank with whitespace collapsed', () => {
    const first = nextTemplateTitle(RAW, context(new Date(2026, 9, 26)), initial, initial)!;
    expect(nextTemplateTitle(RAW, context(undefined), first, first)).toBe('Dept change at Cool Cars, due ( )');
    expect(nextTemplateTitle('A {{month}} {{year}} B', context(undefined), 'A October 2026 B', 'A October 2026 B')).toBe('A B');
  });

  it('(d) does not re-render after a hand edit', () => {
    const first = nextTemplateTitle(RAW, context(new Date(2026, 9, 26)), initial, initial)!;
    expect(nextTemplateTitle(RAW, context(new Date(2027, 0, 5)), `${first} (edited)`, first)).toBeNull();
  });

  it('leaves a template without tokens alone', () => {
    expect(nextTemplateTitle('Plain', context(new Date(2026, 9, 26)), 'Plain', null)).toBeNull();
  });

  it('(e) a late-evening local date does not shift a day, in a timezone west of UTC', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const lateEvening = new Date(2026, 9, 26, 23, 30);
      // Guard: the zone really is west of UTC, and toISOString would have rolled to the 27th.
      expect(lateEvening.getTimezoneOffset()).toBeGreaterThan(0);
      expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-10-27');
      expect(toCalendarDate(lateEvening)).toBe('2026-10-26');
      expect(renderTitleTemplate('{{due_date}}', { dueDate: toCalendarDate(lateEvening) })).toBe('October 26, 2026');
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
