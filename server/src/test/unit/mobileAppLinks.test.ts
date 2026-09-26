import { describe, expect, it } from 'vitest';
import { buildAndroidAssetLinks, buildAppleAppSiteAssociation } from '../../lib/mobileAppLinks';

describe('mobile app link association files', () => {
  it('serves nothing when the deployment has no app credentials', () => {
    expect(buildAppleAppSiteAssociation({})).toBeNull();
    expect(buildAndroidAssetLinks({})).toBeNull();
    expect(buildAndroidAssetLinks({ MOBILE_APP_ANDROID_CERT_FINGERPRINTS: ' , ' })).toBeNull();
  });

  it('claims only the MSP ticket path for the iOS app', () => {
    expect(buildAppleAppSiteAssociation({ MOBILE_APP_APPLE_TEAM_ID: 'ABCDE12345' })).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.com.nineminds.algapsa'],
            components: [{ '/': '/msp/tickets/*' }],
          },
        ],
      },
    });
  });

  it('lists every configured Android signing fingerprint upper-cased', () => {
    const links = buildAndroidAssetLinks({
      MOBILE_APP_ANDROID_CERT_FINGERPRINTS: 'aa:bb:cc, DD:EE:FF',
    });
    expect(links).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.alga.psa.mobile',
          sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
        },
      },
    ]);
  });
});
