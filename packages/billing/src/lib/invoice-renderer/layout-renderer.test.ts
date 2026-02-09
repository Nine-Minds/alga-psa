import { describe, expect, it } from 'vitest';
import { LayoutElementType } from '@alga-psa/types';
import { renderLayout } from './layout-renderer';

describe('renderLayout selector generation', () => {
  it('uses an attribute selector for ids that are invalid CSS id selectors', () => {
    const layout = {
      type: LayoutElementType.Document,
      id: 'designer-document-root',
      children: [
        {
          type: LayoutElementType.Section,
          id: '905c72ef-075b-4d01-bae4-e98979c87a50',
          style: {
            width: '736px',
            paddingLeft: '40px',
          },
          children: [],
        },
      ],
    } as any;

    const rendered = renderLayout(layout);
    expect(rendered.css).toContain('[id="905c72ef-075b-4d01-bae4-e98979c87a50"]');
    expect(rendered.css).not.toContain('#905c72ef-075b-4d01-bae4-e98979c87a50 {');
  });

  it('keeps id selectors for css-safe ids', () => {
    const layout = {
      type: LayoutElementType.Document,
      id: 'designer-document-root',
      children: [
        {
          type: LayoutElementType.Section,
          id: 'designer-page-default-1',
          style: {
            paddingTop: '40px',
            paddingLeft: '40px',
          },
          children: [],
        },
      ],
    } as any;

    const rendered = renderLayout(layout);
    expect(rendered.css).toContain('#designer-page-default-1 {');
  });
});
