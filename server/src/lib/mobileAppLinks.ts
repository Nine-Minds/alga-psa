/**
 * iOS Universal Links / Android App Links association files for the AlgaPSA
 * mobile app. Only ticket links are claimed, so a tapped email "View ticket"
 * button opens the app when it is installed and the browser otherwise.
 *
 * The files are served only when the deployment sets the app credentials
 * (hosted algapsa.com); a self-hosted install without them answers 404, since
 * the app binary cannot claim its domain anyway.
 */

export const MOBILE_APP_IOS_BUNDLE_ID = 'com.nineminds.algapsa';
export const MOBILE_APP_ANDROID_PACKAGE = 'com.alga.psa.mobile';
export const MOBILE_APP_LINK_PATH_PATTERN = '/msp/tickets/*';

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
          components: [{ '/': MOBILE_APP_LINK_PATH_PATTERN }],
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
