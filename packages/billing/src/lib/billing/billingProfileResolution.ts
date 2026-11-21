// The chain lives in `shared/` so the read-side traceability builder
// (shared/billingClients/contractBillingTrace.ts) calls the engine's own
// function rather than re-deriving `line ?? contract ?? default`.
export * from '@alga-psa/shared/billingClients/billingProfileResolution';
