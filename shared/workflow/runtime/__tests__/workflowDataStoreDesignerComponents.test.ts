import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../');
const inputMappingEditorPath = path.join(
  repoRoot,
  'ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx',
);
const inputMappingEditorSource = fs.readFileSync(inputMappingEditorPath, 'utf8');

describe('workflow data-store designer component contracts', () => {
  it('T017: soft-enum fields use the design-system SearchableSelect with custom values, not a native select', () => {
    expect(inputMappingEditorSource).toContain(
      "import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect'",
    );
    expect(inputMappingEditorSource).toContain("softEnum?.component === 'soft-enum-combobox'");
    expect(inputMappingEditorSource).toContain('<SearchableSelect');
    expect(inputMappingEditorSource).toContain('id={`${idPrefix}-literal-soft-enum`}');
    expect(inputMappingEditorSource).toContain('allowCustomValue={softEnum.allowCustomValue !== false}');
    expect(inputMappingEditorSource).toContain('customValueLabel={(nextValue) => t(');
    expect(inputMappingEditorSource).not.toContain('<select');
  });
});
