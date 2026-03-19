export const TEMPLATE_DEFAULT_SCOPE = '__template_defaults__';

type TemplateScopedStatusMapping = {
  template_phase_id?: string | null;
  display_order: number;
};

export function getTemplateDefaultStatusMappings<T extends TemplateScopedStatusMapping>(
  statusMappings: T[]
): T[] {
  return statusMappings
    .filter((mapping) => !mapping.template_phase_id)
    .sort((a, b) => a.display_order - b.display_order);
}

export function getTemplatePhaseStatusMappings<T extends TemplateScopedStatusMapping>(
  statusMappings: T[],
  templatePhaseId?: string | null
): T[] {
  if (!templatePhaseId) {
    return [];
  }

  return statusMappings
    .filter((mapping) => mapping.template_phase_id === templatePhaseId)
    .sort((a, b) => a.display_order - b.display_order);
}

export function hasTemplatePhaseStatusMappings<T extends TemplateScopedStatusMapping>(
  statusMappings: T[],
  templatePhaseId?: string | null
): boolean {
  return getTemplatePhaseStatusMappings(statusMappings, templatePhaseId).length > 0;
}

export function getEffectiveTemplateStatusMappings<T extends TemplateScopedStatusMapping>(
  statusMappings: T[],
  templatePhaseId?: string | null
): T[] {
  const phaseMappings = getTemplatePhaseStatusMappings(statusMappings, templatePhaseId);
  return phaseMappings.length > 0
    ? phaseMappings
    : getTemplateDefaultStatusMappings(statusMappings);
}
