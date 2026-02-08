import { describe, it, expect } from 'vitest';
import { buildInteractionTimeEntryContext } from './timeEntryContext';

const interaction = {
  interaction_id: 'interaction-1',
  title: 'Follow-up',
  type_name: 'Call',
  client_name: 'Globex',
  start_time: new Date('2026-02-01T09:00:00Z'),
  end_time: new Date('2026-02-01T10:00:00Z'),
} as any;

describe('interaction time entry context helper', () => {
  it('builds interaction context with type, client, and times', () => {
    const context = buildInteractionTimeEntryContext(interaction);

    expect(context.workItemId).toBe('interaction-1');
    expect(context.workItemType).toBe('interaction');
    expect(context.interactionType).toBe('Call');
    expect(context.clientName).toBe('Globex');
    expect(context.startTime).toEqual(interaction.start_time);
    expect(context.endTime).toEqual(interaction.end_time);
  });
});
