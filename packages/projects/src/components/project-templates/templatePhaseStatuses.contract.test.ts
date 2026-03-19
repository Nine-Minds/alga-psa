import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../../../..', relativePath), 'utf8');

describe('template phase status contracts', () => {
  const sharedTemplateTypes = readWorkspaceFile('packages/types/src/interfaces/projectTemplate.interfaces.ts');
  const serverTemplateTypes = readWorkspaceFile('server/src/interfaces/projectTemplate.interfaces.ts');
  const managerSource = readWorkspaceFile('packages/projects/src/components/project-templates/TemplateStatusManager.tsx');
  const wizardSource = readWorkspaceFile('packages/projects/src/components/project-templates/wizard-steps/TemplateStatusColumnsStep.tsx');
  const templateActionsSource = readWorkspaceFile('packages/projects/src/actions/projectTemplateActions.ts');

  it('T048: template status mappings include optional template_phase_id in shared and server interfaces', () => {
    expect(sharedTemplateTypes).toContain('template_phase_id?: string;');
    expect(serverTemplateTypes).toContain('template_phase_id?: string;');
  });

  it('T049/T050: template status manager and wizard support phase-aware status scopes', () => {
    expect(managerSource).toContain("const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);");
    expect(managerSource).toContain("{ value: TEMPLATE_DEFAULT_SCOPE, label: 'Template Defaults' },");
    expect(managerSource).toContain('Copy Template Defaults');
    expect(managerSource).toContain('Use Template Defaults');
    expect(managerSource).toContain('copyTemplateStatusesToPhase(templateId, selectedTemplatePhaseId)');
    expect(managerSource).toContain('removeTemplatePhaseStatuses(templateId, selectedTemplatePhaseId)');
    expect(wizardSource).toContain("const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);");
    expect(wizardSource).toContain("{ value: TEMPLATE_DEFAULT_SCOPE, label: 'Template Defaults' },");
    expect(wizardSource).toContain('template_phase_id: selectedPhaseTempId || undefined,');
    expect(wizardSource).toContain('template_phase_id: selectedPhaseTempId,');
    expect(wizardSource).toContain('Copy Template Defaults');
    expect(wizardSource).toContain('Use Template Defaults');
  });

  it('T051/T052: applying a template copies phase-scoped status mappings onto the created project', () => {
    expect(templateActionsSource).toContain("const phaseMap = new Map<string, string>(); // template_phase_id → new_phase_id");
    expect(templateActionsSource).toContain("const getScopeKey = (templatePhaseId?: string | null) => templatePhaseId ?? '__template_defaults__';");
    expect(templateActionsSource).toContain("const getFallbackStatusMappingIdForPhase = (templatePhaseId?: string | null) => {");
    expect(templateActionsSource).toContain("if (options.copyStatuses && templateStatuses.length > 0) {");
    expect(templateActionsSource).toContain("await trx('project_status_mappings')");
    expect(templateActionsSource).toContain('phase_id: templateStatus.template_phase_id');
    expect(templateActionsSource).toContain('phaseMap.get(templateStatus.template_phase_id) ?? null');
    expect(templateActionsSource).toContain('const scopeKey = getScopeKey(templateStatus.template_phase_id);');
  });
});
