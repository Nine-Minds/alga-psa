import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Yjs formatting merge', () => {
  it('merges concurrent formatting updates without corrupting content', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = docA.getText('shared');
    const textB = docB.getText('shared');

    textA.insert(0, 'Hello world');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    docA.transact(() => {
      textA.format(0, 5, { bold: true });
    });

    docB.transact(() => {
      textB.format(6, 5, { italic: true });
    });

    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docA, updateB);
    Y.applyUpdate(docB, updateA);

    expect(textA.toString()).toBe('Hello world');
    expect(textB.toString()).toBe('Hello world');
    expect(textA.toDelta()).toEqual(textB.toDelta());
  });
});
