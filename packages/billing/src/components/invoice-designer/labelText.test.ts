import { describe, expect, it } from 'vitest';

import { resolveLabelText } from './labelText';
import type { DesignerNode } from './state/designerStore';

const nodeWithProps = (props: Record<string, unknown>): DesignerNode => ({
  id: 'node-1',
  type: 'text',
  props,
  position: { x: 0, y: 0 },
  size: { width: 1, height: 1 },
  parentId: null,
  children: [],
  allowedChildren: [],
});

describe('resolveLabelText', () => {
  it('prefers metadata.text over metadata.label and node name', () => {
    const resolved = resolveLabelText(
      nodeWithProps({
        name: 'Name Fallback',
        metadata: {
          text: 'Metadata Text',
          label: 'Metadata Label',
        },
      } as any)
    );

    expect(resolved).toEqual({
      text: 'Metadata Text',
      source: 'metadata.text',
    });
  });

  it('falls back to metadata.label when metadata.text is empty', () => {
    const resolved = resolveLabelText(
      nodeWithProps({
        name: 'Name Fallback',
        metadata: {
          text: '   ',
          label: 'Metadata Label',
        },
      } as any)
    );

    expect(resolved).toEqual({
      text: 'Metadata Label',
      source: 'metadata.label',
    });
  });

  it('does not fall back to node name by default when metadata text fields are empty', () => {
    const resolved = resolveLabelText(
      nodeWithProps({
        name: 'Name Fallback',
        metadata: {
          text: '',
          label: '',
        },
      } as any)
    );

    expect(resolved).toEqual({
      text: '',
      source: 'none',
    });
  });

  it('can include node name fallback when explicitly enabled', () => {
    const resolved = resolveLabelText(
      nodeWithProps({ name: 'Name Fallback', metadata: {} } as any),
      { includeNameFallback: true }
    );

    expect(resolved).toEqual({
      text: 'Name Fallback',
      source: 'name',
    });
  });

  it('supports skipping candidates with a custom predicate', () => {
    const resolved = resolveLabelText(
      nodeWithProps({
        name: 'Invoice Number Label',
        metadata: {
          text: 'Label',
          label: 'Invoice #',
        },
      } as any),
      { shouldSkip: (value) => value.toLowerCase() === 'label' }
    );

    expect(resolved).toEqual({
      text: 'Invoice #',
      source: 'metadata.label',
    });
  });
});
