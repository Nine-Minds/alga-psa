import { describe, expect, it } from 'vitest';

import { resolveLabelText } from './labelText';

describe('resolveLabelText', () => {
  it('prefers metadata.text over metadata.label and node name', () => {
    const resolved = resolveLabelText({
      name: 'Name Fallback',
      metadata: {
        text: 'Metadata Text',
        label: 'Metadata Label',
      },
    });

    expect(resolved).toEqual({
      text: 'Metadata Text',
      source: 'metadata.text',
    });
  });

  it('falls back to metadata.label when metadata.text is empty', () => {
    const resolved = resolveLabelText({
      name: 'Name Fallback',
      metadata: {
        text: '   ',
        label: 'Metadata Label',
      },
    });

    expect(resolved).toEqual({
      text: 'Metadata Label',
      source: 'metadata.label',
    });
  });

  it('falls back to node name when metadata text fields are empty', () => {
    const resolved = resolveLabelText({
      name: 'Name Fallback',
      metadata: {
        text: '',
        label: '',
      },
    });

    expect(resolved).toEqual({
      text: 'Name Fallback',
      source: 'name',
    });
  });

  it('can resolve only explicit metadata text fields without name fallback', () => {
    const resolved = resolveLabelText(
      {
        name: 'Name Fallback',
        metadata: {},
      },
      { includeNameFallback: false }
    );

    expect(resolved).toEqual({
      text: '',
      source: 'none',
    });
  });

  it('supports skipping candidates with a custom predicate', () => {
    const resolved = resolveLabelText(
      {
        name: 'Invoice Number Label',
        metadata: {
          text: 'Label',
          label: 'Invoice #',
        },
      },
      { shouldSkip: (value) => value.toLowerCase() === 'label' }
    );

    expect(resolved).toEqual({
      text: 'Invoice #',
      source: 'metadata.label',
    });
  });
});
