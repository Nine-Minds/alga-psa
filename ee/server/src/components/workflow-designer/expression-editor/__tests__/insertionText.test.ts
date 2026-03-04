import { describe, expect, it } from 'vitest';
import { normalizeInsertedText } from '../insertionText';

describe('expression editor insertion text normalization', () => {
  it('strips trailing Monaco snippet cursor placeholders', () => {
    expect(normalizeInsertedText('vars.result$0')).toBe('vars.result');
  });

  it('leaves non-trailing placeholders and plain paths unchanged', () => {
    expect(normalizeInsertedText('vars.$0.result')).toBe('vars.$0.result');
    expect(normalizeInsertedText('payload.customer.name')).toBe('payload.customer.name');
  });
});
