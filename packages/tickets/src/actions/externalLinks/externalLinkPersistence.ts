// Compatibility re-export. The implementation lives in `shared/` because ticket creation
// (`applyCreatedFromTemplateEffects`) writes links and shared must not import `@alga-psa/tickets`.
export * from '@alga-psa/shared/services/tickets/externalLinkPersistence';
