import { describe, expect, it } from 'vitest';

import { repairUtf8Mojibake } from '../inboundEmailMimeHelpers';

describe('repairUtf8Mojibake', () => {
  it('repairs the double-encoded German subject seen in production', () => {
    expect(repairUtf8Mojibake('[MICT Support] Claude fÃ¼r mich')).toBe('[MICT Support] Claude für mich');
  });

  it('repairs double-encoded Arabic and Cyrillic subjects', () => {
    expect(repairUtf8Mojibake('Ù…Ø±Ø­Ø¨Ø§ Ø¨Ø§Ù„Ø¹Ø§Ù„Ù…')).toBe('مرحبا بالعالم');
    expect(repairUtf8Mojibake('ÐŸÑ€Ð¸Ð²ÐµÑ‚, Ð¼Ð¸Ñ€')).toBe('Привет, мир');
  });

  it('repairs mojibake that routes through CP1252-only characters', () => {
    expect(repairUtf8Mojibake('Canâ€™t open â€” help')).toBe('Can’t open — help');
  });

  it.each([
    ['already-clean umlauts', 'Claude für mich'],
    ['French Latin-1 accents', 'Café résumé à côté'],
    ['pure ASCII', '[MICT Support] Claude for me'],
    ['emoji', 'Printer is down 🔥 please help'],
    ['invalid byte sequences', 'Matrix 3Ã3'],
    ['empty string', ''],
  ])('leaves %s untouched', (_label, subject) => {
    expect(repairUtf8Mojibake(subject)).toBe(subject);
  });

  it('caps repair at two passes so pathological input cannot loop', () => {
    // Triple-encoded "für": two passes peel two layers, the third stays.
    expect(repairUtf8Mojibake('fÃƒÆ’Ã‚Â¼r')).toBe('fÃ¼r');
    expect(repairUtf8Mojibake('fÃƒÂ¼r')).toBe('für');
  });
});
