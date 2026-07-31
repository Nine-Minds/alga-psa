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

export interface EntraFieldSyncRule {
  key: keyof EntraFieldSyncConfig;
  labelKey: string;
  descriptionKey: string;
}

/**
 * The overwrite rules, in order, as data.
 *
 * Every surface that shows "what may this sync change" reads this list rather
 * than naming fields by hand: the console rail used to hard-code three of the
 * five as copy-pasted rows, so turning on the email or UPN rule changed the
 * sync and changed nothing on the card whose whole job is saying what the sync
 * is allowed to change.
 */
export const ENTRA_OVERWRITE_RULES: EntraFieldSyncRule[] = [
  'displayName',
  'email',
  'phone',
  'role',
  'upn',
].map((key) => ({
  key: key as keyof EntraFieldSyncConfig,
  labelKey: `integrations.entra.settings.fieldSync.options.${key}.label`,
  descriptionKey: `integrations.entra.settings.fieldSync.options.${key}.description`,
}));

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
