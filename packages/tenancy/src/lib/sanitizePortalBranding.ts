import type { TenantBranding } from '../actions/tenant-actions/tenantBrandingActions';

/** Settings are a JSONB bag; never serialize unknown stored keys to portal clients. */
export function sanitizePortalBranding(value: unknown): TenantBranding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    'logoUrl', 'logoDarkUrl', 'logoWideUrl', 'logoWideDarkUrl', 'faviconUrl',
    'primaryColor', 'secondaryColor', 'clientName', 'supportEmail', 'supportPhone',
    'computedStyles',
  ]) {
    const field = input[key];
    if (typeof field === 'string') output[key] = field;
  }
  if (input.portalHeroGradient === 'primary-shades' || input.portalHeroGradient === 'primary-secondary') output.portalHeroGradient = input.portalHeroGradient;
  if (input.portalSidebarStyle === 'default' || input.portalSidebarStyle === 'primary' || input.portalSidebarStyle === 'secondary' || input.portalSidebarStyle === 'custom') output.portalSidebarStyle = input.portalSidebarStyle;
  if (typeof input.portalSidebarColor === 'string') output.portalSidebarColor = input.portalSidebarColor;
  if (typeof input.portalFollowsTheme === 'boolean') output.portalFollowsTheme = input.portalFollowsTheme;
  if (Object.keys(output).length === 0) return null;
  return output as unknown as TenantBranding;
}
