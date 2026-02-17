import { describe, expect, it } from 'vitest';

import { resolveContainerLayoutStyle, resolveNodeBoxStyle } from './cssLayout';

describe('cssLayout', () => {
  it('maps flex container layout props to inline CSS style', () => {
    const style = resolveContainerLayoutStyle({
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'stretch',
      gap: '8px',
      padding: '12px',
    });

    expect(style).toMatchObject({
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'stretch',
      gap: '8px',
      padding: '12px',
    });
    expect('gridTemplateColumns' in style).toBe(false);
    expect('gridTemplateRows' in style).toBe(false);
    expect('gridAutoFlow' in style).toBe(false);
  });

  it('maps grid container layout props to inline CSS style', () => {
    const style = resolveContainerLayoutStyle({
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gridTemplateRows: 'auto',
      gridAutoFlow: 'row dense',
      gap: '6px',
      padding: '4px',
    });

    expect(style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gridTemplateRows: 'auto',
      gridAutoFlow: 'row dense',
      gap: '6px',
      padding: '4px',
    });
    expect('flexDirection' in style).toBe(false);
    expect('justifyContent' in style).toBe(false);
    expect('alignItems' in style).toBe(false);
  });

  it('maps node sizing + flex item + media props to inline CSS style', () => {
    const style = resolveNodeBoxStyle({
      width: '320px',
      height: 'auto',
      minWidth: '12rem',
      minHeight: '40px',
      maxWidth: '100%',
      maxHeight: '480px',
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: '240px',
      aspectRatio: '16 / 9',
      objectFit: 'contain',
    });

    expect(style).toMatchObject({
      width: '320px',
      height: 'auto',
      minWidth: '12rem',
      minHeight: '40px',
      maxWidth: '100%',
      maxHeight: '480px',
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: '240px',
      aspectRatio: '16 / 9',
      objectFit: 'contain',
    });
  });
});

