import { describe, expect, it } from 'vitest';
import { getPathInsertionStart, normalizeInsertedText } from '../insertionText';

describe('expression editor insertion text normalization', () => {
  it('strips trailing Monaco snippet cursor placeholders', () => {
    expect(normalizeInsertedText('vars.result$0')).toBe('vars.result');
  });

  it('leaves non-trailing placeholders and plain paths unchanged', () => {
    expect(normalizeInsertedText('vars.$0.result')).toBe('vars.$0.result');
    expect(normalizeInsertedText('payload.customer.name')).toBe('payload.customer.name');
  });

  it('replaces a partly typed path that the inserted path completes', () => {
    const before = 'payload.a = 1 and vars.ticket.pri';
    expect(getPathInsertionStart(before, 'vars.ticket.priority_id')).toBe(before.length - 'vars.ticket.pri'.length);
  });

  it('inserts at the caret when the text before it is not a prefix of the inserted path', () => {
    expect(getPathInsertionStart('vars.board_id = ', 'vars.ticket.priority_id')).toBe('vars.board_id = '.length);
    expect(getPathInsertionStart('payload.x & ', 'vars.ticket.title')).toBe('payload.x & '.length);
    expect(getPathInsertionStart('pri', 'vars.ticket.priority_id')).toBe(3);
  });
});
