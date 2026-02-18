import { describe, expect, it } from 'vitest';
import { createAstDocument, findNodeById, getDocumentNode, roundTripAst } from './workspaceAst.roundtrip.helpers';

type InlineStyleCase = {
  key: string;
  value: unknown;
  expected?: unknown;
};

describe('workspaceAst roundtrip style matrix', () => {
  const styleCases: InlineStyleCase[] = [
    { key: 'display', value: 'flex' },
    { key: 'width', value: '320px' },
    { key: 'height', value: '180px' },
    { key: 'minWidth', value: '160px' },
    { key: 'minHeight', value: '40px' },
    { key: 'maxWidth', value: '640px' },
    { key: 'maxHeight', value: '420px' },
    { key: 'padding', value: '10px 12px' },
    { key: 'margin', value: '8px 0' },
    { key: 'border', value: '1px solid #d1d5db' },
    { key: 'borderRadius', value: '8px' },
    { key: 'gap', value: '12px' },
    { key: 'justifyContent', value: 'space-between' },
    { key: 'alignItems', value: 'center' },
    { key: 'color', value: '#111827' },
    { key: 'backgroundColor', value: '#f9fafb' },
    { key: 'fontSize', value: '14px' },
    { key: 'fontWeight', value: 600 },
    { key: 'fontFamily', value: '"IBM Plex Sans", sans-serif' },
    { key: 'lineHeight', value: 1.35 },
    { key: 'textAlign', value: 'right' },
    { key: 'flexDirection', value: 'row' },
    { key: 'flexGrow', value: 1 },
    { key: 'flexShrink', value: 0 },
    { key: 'flexBasis', value: 'auto' },
    { key: 'aspectRatio', value: '16 / 9' },
    { key: 'objectFit', value: 'contain' },
    { key: 'gridTemplateColumns', value: '1fr 2fr' },
    { key: 'gridTemplateRows', value: 'auto auto' },
    { key: 'gridAutoFlow', value: 'row dense' },
  ];

  it.each(styleCases)('round-trips inline style property %s', ({ key, value, expected }) => {
    const ast = createAstDocument([
      {
        id: 'styled-text',
        type: 'text',
        content: { type: 'literal', value: 'Styled' },
        style: {
          inline: {
            [key]: value,
          } as Record<string, unknown>,
        } as any,
      },
    ]);

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const styled = findNodeById(layout, 'styled-text');
    expect(styled?.type).toBe('text');
    if (!styled) return;

    const inline = styled.style?.inline as Record<string, unknown> | undefined;
    expect(inline).toBeTruthy();
    expect(inline?.[key]).toEqual(expected ?? value);
  });

  it('round-trips style tokenIds with inline declarations', () => {
    const ast = createAstDocument([
      {
        id: 'tokenized-text',
        type: 'text',
        content: { type: 'literal', value: 'Tokenized' },
        style: {
          tokenIds: ['text-primary', 'text-lg'],
          inline: {
            color: '#1f2937',
            fontWeight: 700,
          },
        } as any,
      },
    ]);

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const tokenized = findNodeById(layout, 'tokenized-text');
    expect(tokenized?.type).toBe('text');
    if (!tokenized) return;

    expect(tokenized.style?.tokenIds).toEqual(['text-primary', 'text-lg']);
    expect(tokenized.style?.inline).toMatchObject({
      color: '#1f2937',
      fontWeight: 700,
    });
  });
});
