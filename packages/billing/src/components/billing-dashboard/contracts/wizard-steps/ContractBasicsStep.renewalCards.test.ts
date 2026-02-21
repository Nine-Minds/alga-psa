import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ContractBasicsStep.tsx', import.meta.url), 'utf8');

describe('ContractBasicsStep renewal card rendering', () => {
  it('renders the fixed-term Renewal Settings card when end date is present', () => {
    expect(source).toContain('{data.end_date && (');
    expect(source).toContain('data-automation-id="renewal-settings-fixed-term-card"');
    expect(source).toContain('Renewal Settings');
  });
});
