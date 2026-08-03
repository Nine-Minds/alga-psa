export const EDITION_GATE_CODE = 'EE_REQUIRED' as const;

export const EDITION_GATED_FEATURES = {
  mcp: { name: 'MCP server' },
  'platform-notifications': { name: 'Platform notifications' },
  'platform-reports': { name: 'Platform reports' },
  'platform-feature-flags': { name: 'Platform feature flags' },
  'tenant-management': { name: 'Tenant management' },
  'appliance-installs': { name: 'Appliance installs' },
} as const;

export type EditionGatedFeature = keyof typeof EDITION_GATED_FEATURES;

export interface EditionGateResponseBody {
  error: string;
  code: typeof EDITION_GATE_CODE;
  feature: EditionGatedFeature;
  featureName: string;
  message: string;
  upgrade: {
    product: 'Alga PSA Pro';
    cta: 'View Plans';
    href: 'https://www.nineminds.com/plans';
  };
}

export function createEditionGateResponseBody(feature: EditionGatedFeature): EditionGateResponseBody {
  const featureName = EDITION_GATED_FEATURES[feature].name;

  return {
    error: 'This endpoint requires Alga PSA Pro.',
    code: EDITION_GATE_CODE,
    feature,
    featureName,
    message: `${featureName} is available with Alga PSA Pro.`,
    upgrade: {
      product: 'Alga PSA Pro',
      cta: 'View Plans',
      href: 'https://www.nineminds.com/plans',
    },
  };
}

export function isEditionGateResponseBody(value: unknown): value is EditionGateResponseBody {
  if (!value || typeof value !== 'object') return false;

  const body = value as Record<string, unknown>;
  if (
    typeof body.feature !== 'string' ||
    !Object.prototype.hasOwnProperty.call(EDITION_GATED_FEATURES, body.feature)
  ) {
    return false;
  }

  const feature = body.feature as EditionGatedFeature;
  const upgrade = body.upgrade;

  return (
    body.code === EDITION_GATE_CODE &&
    typeof body.error === 'string' &&
    body.featureName === EDITION_GATED_FEATURES[feature].name &&
    typeof body.message === 'string' &&
    !!upgrade &&
    typeof upgrade === 'object' &&
    (upgrade as Record<string, unknown>).product === 'Alga PSA Pro' &&
    (upgrade as Record<string, unknown>).cta === 'View Plans' &&
    (upgrade as Record<string, unknown>).href === 'https://www.nineminds.com/plans'
  );
}
