import { describe, expect, it } from 'vitest';

import { CategoryPicker } from '@alga-psa/ui/components/tickets/CategoryPicker';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';

describe('ui ticket pickers', () => {
  it('exports PrioritySelect', () => {
    expect(PrioritySelect).toBeTypeOf('function');
  });

  it('exports CategoryPicker', () => {
    expect(CategoryPicker).toBeTypeOf('function');
  });
});
