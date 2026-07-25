import type { EntraFieldSyncConfig } from '@alga-psa/integrations/actions';

/**
 * The overwrite rules as data.
 *
 * Split from the component so a surface that only needs to *read* the rules —
 * the wizard, the console's side rail — does not have to import the switches,
 * the preview and everything they drag in behind them.
 *
 * Overwrite rules default off: a sync that quietly rewrites a technician's
 * carefully corrected contact record is the fastest way to lose trust in it.
 * Inactivation defaults on, because a disabled Microsoft account is a fact
 * worth reflecting, and it only ever marks — never deletes.
 */
export const DEFAULT_ENTRA_FIELD_SYNC_CONFIG: EntraFieldSyncConfig = {
  displayName: false,
  email: false,
  phone: false,
  role: false,
  upn: false,
  markInactiveWhenDisabled: true,
};

export function normalizeEntraFieldSyncConfig(value: unknown): EntraFieldSyncConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_ENTRA_FIELD_SYNC_CONFIG };
  }

  const source = value as Record<string, unknown>;
  return {
    displayName: source.displayName === true,
    email: source.email === true,
    phone: source.phone === true,
    role: source.role === true,
    upn: source.upn === true,
    markInactiveWhenDisabled: source.markInactiveWhenDisabled !== false,
  };
}
