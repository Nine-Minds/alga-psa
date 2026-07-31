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
  const applyTemplateSource = readWorkspaceFile('packages/projects/src/services/applyProjectTemplate.ts');

  it('T048: template status mappings include optional template_phase_id in shared and server interfaces', () => {
    expect(sharedTemplateTypes).toContain('template_phase_id?: string;');
    expect(serverTemplateTypes).toContain('template_phase_id?: string;');
  });

  it('T049/T050: template status manager and wizard support phase-aware status scopes', () => {
    expect(managerSource).toContain("const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);");
    expect(managerSource).toContain("{ value: TEMPLATE_DEFAULT_SCOPE, label: t('templates.statuses.template_defaults') },");
    expect(managerSource).toContain('id="copy-template-default-statuses"');
    expect(managerSource).toContain('onClick={handleEnableCustomStatuses}');
    expect(managerSource).toContain('id="use-template-default-statuses"');
    expect(managerSource).toContain('onClick={() => setResetToDefaultsConfirmation(true)}');
    expect(managerSource).toContain('copyTemplateStatusesToPhase(templateId, selectedTemplatePhaseId)');
    expect(managerSource).toContain('removeTemplatePhaseStatuses(templateId, selectedTemplatePhaseId)');
    expect(wizardSource).toContain("const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);");
    expect(wizardSource).toContain("{ value: TEMPLATE_DEFAULT_SCOPE, label: t('templates.statuses.template_defaults') },");
    expect(wizardSource).toContain('template_phase_id: selectedPhaseTempId || undefined,');
    expect(wizardSource).toContain('template_phase_id: selectedPhaseTempId,');
    expect(wizardSource).toContain('id="wizard-copy-default-statuses"');
    expect(wizardSource).toContain('onClick={copyDefaultsToPhase}');
    expect(wizardSource).toContain('id="wizard-use-default-statuses"');
  });

  it('T051/T052: applying a template copies phase-scoped status mappings onto the created project', () => {
    expect(applyTemplateSource).toContain("const phaseMap = new Map<string, string>(); // template_phase_id → new_phase_id");
    expect(applyTemplateSource).toContain("const getScopeKey = (templatePhaseId?: string | null) => templatePhaseId ?? '__template_defaults__';");
    expect(applyTemplateSource).toContain("const getFallbackStatusMappingIdForPhase = (templatePhaseId?: string | null) => {");
    expect(applyTemplateSource).toContain("if (options.copyStatuses && templateStatuses.length > 0) {");
    expect(applyTemplateSource).toContain("await tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(applyTemplateSource).toContain('phase_id: templateStatus.template_phase_id');
    expect(applyTemplateSource).toContain('phaseMap.get(templateStatus.template_phase_id) ?? null');
    expect(applyTemplateSource).toContain('const scopeKey = getScopeKey(templateStatus.template_phase_id);');
  });
});
