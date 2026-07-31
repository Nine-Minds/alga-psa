/** @vitest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Integration module designer icon contracts (T018)', () => {
  it('WorkflowDesigner maps every integration module icon token to a dedicated icon', () => {
    const workflowDesignerSource = fs.readFileSync(path.resolve(__dirname, '../WorkflowDesigner.tsx'), 'utf8');
    for (const token of ['ninjaone', 'tacticalrmm', 'levelio', 'huntress', 'teams']) {
      expect(workflowDesignerSource).toContain(`case '${token}'`);
    }
  });
});
