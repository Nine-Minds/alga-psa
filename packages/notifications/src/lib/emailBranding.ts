/**
 * Email white-labeling: the types and pure helpers shared by the branding
 * server actions and the settings panel.
 *
 * Kept out of the actions file because that one carries "use server", where
 * only async functions may be exported.
 */

import {
  isHexColor,
  normalizeHex,
  type EmailBrandingPalette,
  type EmailBrandingSuggestion,
  type EmailPaletteOverrides,
  type EmailPaletteTokens,
  type PlannedTemplateSkip,
  type TenantTemplateDifference,
  type TenantTemplateState,
} from '@alga-psa/email/branding';

export interface EmailBrandingTemplateStatus {
  name: string;
  language: string;
  category: string;
  systemTemplateId: number;
  state: TenantTemplateState;
  differs: TenantTemplateDifference[];
  /** System template with no tenant row that arrived after the last apply. */
  isNew: boolean;
}

export interface EmailBrandingLogoOptions {
  logoUrl?: string;
  logoWideUrl?: string;
  clientName?: string;
}

export interface EmailBrandingStatus {
  palette: EmailBrandingPalette | null;
  resolved: EmailPaletteTokens;
  suggestion: EmailBrandingSuggestion;
  /** Languages the tenant has enabled, restricted to those templates exist in. */
  languages: string[];
  availableLanguages: string[];
  templates: EmailBrandingTemplateStatus[];
  newTemplateNames: string[];
  canEdit: boolean;
  isEnterprise: boolean;
  logoOptions: EmailBrandingLogoOptions;
}

export interface EmailBrandingWrittenRow {
  name: string;
  language: string;
  action: 'created' | 'updated';
}

export interface EmailBrandingFailedRow {
  name: string;
  language: string;
  error: string;
}

export interface EmailBrandingApplyResult {
  written: EmailBrandingWrittenRow[];
  skipped: PlannedTemplateSkip[];
  failed: EmailBrandingFailedRow[];
  appliedAt: string | null;
}

export interface EmailBrandingRemoveResult {
  removed: number;
  kept: number;
}

export interface EmailBrandingPaletteInput {
  primary: string;
  secondary?: string | null;
  overrides?: EmailPaletteOverrides;
  logo?: { variant: 'wide' | 'default' } | null;
  hideAttribution?: boolean;
}

export interface TenantSettingsBlob {
  theme?: unknown;
  branding?: Record<string, any> | null;
  emailBranding?: Record<string, any> | null;
  defaultLocale?: unknown;
  mspPortal?: { defaultLocale?: unknown } | null;
  clientPortal?: { defaultLocale?: unknown; enabledLocales?: unknown } | null;
}

/** 'en-AU' and 'pt_BR' both describe a language we ship templates for. */
function toLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase().split(/[-_]/)[0];
  return code.length === 2 ? code : null;
}

/**
 * The languages the apply dialog preselects: whatever the tenant configured for
 * the MSP shell and the client portal, always including English so a tenant
 * that configured nothing still gets a usable default.
 */
export function resolveTenantLanguages(settings: TenantSettingsBlob, available: string[]): string[] {
  const candidates = [
    settings.defaultLocale,
    settings.mspPortal?.defaultLocale,
    settings.clientPortal?.defaultLocale,
    ...(Array.isArray(settings.clientPortal?.enabledLocales) ? settings.clientPortal!.enabledLocales : []),
  ];

  const languages = new Set<string>(['en']);
  for (const candidate of candidates) {
    const code = toLanguageCode(candidate);
    if (code && available.includes(code)) languages.add(code);
  }

  return [...languages].filter((code) => available.length === 0 || available.includes(code)).sort();
}

/** Reads the persisted palette, ignoring a blob that carries no usable primary. */
export function readEmailBrandingPalette(raw: unknown): EmailBrandingPalette | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, any>;
  if (!isHexColor(value.primary)) return null;

  return {
    primary: normalizeHex(value.primary)!,
    secondary: isHexColor(value.secondary) ? normalizeHex(value.secondary)! : null,
    ...(value.overrides && typeof value.overrides === 'object' ? { overrides: value.overrides } : {}),
    ...(value.logo?.variant === 'wide' || value.logo?.variant === 'default'
      ? { logo: { variant: value.logo.variant } }
      : {}),
    ...(value.hideAttribution === true ? { hideAttribution: true } : {}),
    ...(typeof value.appliedAt === 'string' ? { appliedAt: value.appliedAt } : {}),
    ...(value.appliedPalette && typeof value.appliedPalette === 'object'
      ? { appliedPalette: value.appliedPalette as EmailPaletteTokens }
      : {}),
  };
}

function assertHex(value: string, field: string): string {
  const normalized = normalizeHex(value);
  if (!normalized) throw new Error(`Invalid email branding color for ${field}: ${value}`);
  return normalized;
}

/**
 * Validates the palette and, on Community, drops the Enterprise-only fields the
 * way scopeBrandingToEdition does — hiding the controls in the UI is not the
 * enforcement point.
 */
export function normalizeEmailBrandingInput(
  input: EmailBrandingPaletteInput,
  enterprise: boolean,
): Omit<EmailBrandingPalette, 'appliedAt' | 'appliedPalette'> {
  const overrides: EmailPaletteOverrides = {};

  for (const [key, value] of Object.entries(input.overrides ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'badgeAlpha') {
      const alpha = Number(value);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new Error(`Invalid email branding badge alpha: ${value}`);
      }
      overrides.badgeAlpha = alpha;
      continue;
    }
    (overrides as Record<string, string>)[key] = assertHex(String(value), key);
  }

  return {
    primary: assertHex(input.primary, 'primary'),
    secondary: input.secondary ? assertHex(input.secondary, 'secondary') : null,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(enterprise && input.logo?.variant ? { logo: { variant: input.logo.variant } } : {}),
    ...(enterprise && input.hideAttribution ? { hideAttribution: true } : {}),
  };
}

/**
 * Knex prefixes the failing SQL — bound HTML and all — onto the driver's
 * report. Keep only the report so the apply dialog never shows raw SQL.
 */
export function describeTemplateWriteError(error: unknown): string {
  if (error instanceof Error && error.message) {
    const separator = error.message.lastIndexOf(' - ');
    const summary = (separator >= 0 ? error.message.slice(separator + 3) : error.message).trim();
    if (summary && !/^(insert|update|select|delete|alter|with)\b/i.test(summary)) {
      return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary;
    }
  }
  return 'Failed to write templates';
}
