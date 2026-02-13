import { describe, expect, it } from 'vitest';

import { resolveInsertPositionFromRects } from './dropIndicator';

describe('resolveInsertPositionFromRects', () => {
  it('uses x-axis midpoint rule for row flex containers', () => {
    const position = resolveInsertPositionFromRects(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 100, top: 0, width: 10, height: 10 },
      'x'
    );
    expect(position).toBe('before');

    const position2 = resolveInsertPositionFromRects(
      { left: 200, top: 0, width: 10, height: 10 },
      { left: 100, top: 0, width: 10, height: 10 },
      'x'
    );
    expect(position2).toBe('after');
  });

  it('uses y-axis midpoint rule for column flex containers', () => {
    const position = resolveInsertPositionFromRects(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 0, top: 100, width: 10, height: 10 },
      'y'
    );
    expect(position).toBe('before');

    const position2 = resolveInsertPositionFromRects(
      { left: 0, top: 200, width: 10, height: 10 },
      { left: 0, top: 100, width: 10, height: 10 },
      'y'
    );
    expect(position2).toBe('after');
  });
});

