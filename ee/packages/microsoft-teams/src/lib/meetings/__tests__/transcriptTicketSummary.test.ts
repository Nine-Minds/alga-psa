import { describe, expect, it } from 'vitest';
import { vttToDialogue } from '../transcriptTicketSummary';

describe('vttToDialogue', () => {
  it('drops WEBVTT structure and unwraps voice tags to speaker lines', () => {
    const vtt = [
      'WEBVTT',
      '',
      '1',
      '00:00:00.000 --> 00:00:04.000',
      '<v Dorothy Gale>The printer is on fire again.</v>',
      '',
      '2',
      '00:00:04.500 --> 00:00:08.000',
      '<v Glinda>I will open a ticket and dispatch someone.',
      '',
      'NOTE internal cue comment',
      'Plain line without voice tag',
    ].join('\n');

    expect(vttToDialogue(vtt)).toBe(
      [
        'Dorothy Gale: The printer is on fire again.',
        'Glinda: I will open a ticket and dispatch someone.',
        'Plain line without voice tag',
      ].join('\n')
    );
  });

  it('strips residual markup and caps output length', () => {
    const vtt = `WEBVTT\n\n00:00.000 --> 00:02.000\nHello <b>there</b>\n${'x'.repeat(30_000)}`;
    const result = vttToDialogue(vtt);
    expect(result.startsWith('Hello there')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20_000);
  });

  it('returns empty for empty or header-only input', () => {
    expect(vttToDialogue('')).toBe('');
    expect(vttToDialogue('WEBVTT\n\n00:00.000 --> 00:01.000')).toBe('');
  });
});
