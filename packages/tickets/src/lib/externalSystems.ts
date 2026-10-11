// Compatibility export for ticket-package consumers. The implementation lives
// in a horizontal package so other feature packages can share it without
// introducing feature-to-feature dependencies.
export {
  customExternalSystemToDefinition,
  findBuiltInExternalSystem,
  isBuiltInExternalSystemKey,
  isCustomExternalSystemKey,
  isValidExternalUrl,
  listExternalSystems,
  renderExternalLinkUrl,
  resolveExternalSystem,
  resolveExternalSystemOrigin,
  safeExternalUrl,
} from '@alga-psa/types';
