import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import { DnDFlow } from 'server/src/empty/workflows/entry';

describe('CE workflows stub entry', () => {
  it('renders stub messaging and does not crash', () => {
    const html = renderToStaticMarkup(React.createElement(DnDFlow));
    expect(html).toContain('Enterprise Feature');
    expect(html).toContain('Workflow designer requires Enterprise Edition');
  });
});

