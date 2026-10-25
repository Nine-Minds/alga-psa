/**
 * iOS Universal Links / Android App Links association files for the AlgaPSA
 * mobile app. Ticket, asset and stock-unit links are claimed, so a tapped email "View ticket"
 * button or a scanned label opens the app when it is installed and the browser otherwise.
 *
 * The files are served only when the deployment sets the app credentials
 * (hosted algapsa.com); a self-hosted install without them answers 404, since
 * the app binary cannot claim its domain anyway.
 */

export const MOBILE_APP_IOS_BUNDLE_ID = 'com.nineminds.algapsa';
export const MOBILE_APP_ANDROID_PACKAGE = 'com.alga.psa.mobile';

/**
 * AASA `components` the app claims: tickets, assets, and stock units (the unit
 * URL is `?unitId=` on the units page, so the query must be present). Project
 * tasks are routed by the app but deliberately NOT claimed: claiming
 * `/msp/projects/*` would hand project pages the app cannot show to the app.
 * `ee/mobile/app.json` must claim the same record types (parity test).
 */
export const MOBILE_APP_LINK_COMPONENTS: ReadonlyArray<Record<string, unknown>> = [
  { '/': '/msp/tickets/*' },
  { '/': '/msp/assets/*' },
  { '/': '/msp/inventory/units', '?': { unitId: '*' } },
];

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildAppleAppSiteAssociation(
  env: Record<string, string | undefined> = process.env
): Record<string, unknown> | null {
  const teamId = (env.MOBILE_APP_APPLE_TEAM_ID ?? '').trim();
  if (!teamId) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${MOBILE_APP_IOS_BUNDLE_ID}`],
          components: MOBILE_APP_LINK_COMPONENTS.map((component) => ({ ...component })),
        },
      ],
    },
  };
}

export function buildAndroidAssetLinks(
  env: Record<string, string | undefined> = process.env
): Record<string, unknown>[] | null {
  const fingerprints = splitList(env.MOBILE_APP_ANDROID_CERT_FINGERPRINTS).map((f) => f.toUpperCase());
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: MOBILE_APP_ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
