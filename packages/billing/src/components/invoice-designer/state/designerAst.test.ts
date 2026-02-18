import { describe, expect, it } from 'vitest';

import type { DesignerAstWorkspace } from './designerAst';
import { traverseDesignerAstNodeIds } from './designerAst';

describe('designerAst', () => {
  it('traverses from rootId deterministically using children order (independent of nodesById key order)', () => {
    const workspace: DesignerAstWorkspace = {
      rootId: 'doc',
      nodesById: {
        // Intentionally non-topological insertion order.
        b: { id: 'b', type: 'section', props: { name: 'B' }, children: ['c'] },
        c: { id: 'c', type: 'text', props: { name: 'C' }, children: [] },
        doc: { id: 'doc', type: 'document', props: { name: 'Doc' }, children: ['a', 'b'] },
        a: { id: 'a', type: 'text', props: { name: 'A' }, children: [] },
      },
    };

    expect(traverseDesignerAstNodeIds(workspace)).toEqual(['doc', 'a', 'b', 'c']);
  });

  it('does not throw when children references are missing (skips unknown ids)', () => {
    const workspace: DesignerAstWorkspace = {
      rootId: 'doc',
      nodesById: {
        doc: { id: 'doc', type: 'document', props: { name: 'Doc' }, children: ['missing'] },
      },
    };

    expect(traverseDesignerAstNodeIds(workspace)).toEqual(['doc']);
  });

  it('does not loop forever on cycles', () => {
    const workspace: DesignerAstWorkspace = {
      rootId: 'doc',
      nodesById: {
        doc: { id: 'doc', type: 'document', props: { name: 'Doc' }, children: ['a'] },
        a: { id: 'a', type: 'section', props: { name: 'A' }, children: ['doc'] },
      },
    };

    expect(traverseDesignerAstNodeIds(workspace)).toEqual(['doc', 'a']);
  });
});
