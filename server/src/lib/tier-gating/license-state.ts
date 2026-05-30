// Re-export from the shared licensing package for use within the server.
export {
  getLicenseStateRow,
  upsertLicenseState,
  resolveSelfHostTier,
  eeRuntimeEnabledServer,
  type LicenseStateRow,
  type LicenseStateKind,
  type ResolvedLicenseState,
} from '@alga-psa/licensing';
