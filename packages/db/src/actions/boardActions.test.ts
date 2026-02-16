import { describe, expect, it } from 'vitest';

import { getAllBoards } from '@alga-psa/db/actions';

describe('db boardActions', () => {
  it('exports getAllBoards', () => {
    expect(getAllBoards).toBeTypeOf('function');
  });
});
