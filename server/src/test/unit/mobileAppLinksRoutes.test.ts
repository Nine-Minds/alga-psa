import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getAasa } from '../../app/.well-known/apple-app-site-association/route';
import { GET as getAssetLinks } from '../../app/.well-known/assetlinks.json/route';

describe('.well-known mobile app link routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers 404 when the deployment has no app credentials', async () => {
    vi.stubEnv('MOBILE_APP_APPLE_TEAM_ID', '');
    vi.stubEnv('MOBILE_APP_ANDROID_CERT_FINGERPRINTS', '');
    expect((await getAasa()).status).toBe(404);
    expect((await getAssetLinks()).status).toBe(404);
  });

  it('serves apple-app-site-association as cacheable JSON', async () => {
    vi.stubEnv('MOBILE_APP_APPLE_TEAM_ID', 'ABCDE12345');
    const res = await getAasa();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const body = await res.json();
    expect(body.applinks.details[0].appIDs).toEqual(['ABCDE12345.com.nineminds.algapsa']);
    expect(body.applinks.details[0].components).toEqual([{ '/': '/msp/tickets/*' }]);
  });

  it('serves assetlinks.json as cacheable JSON', async () => {
    vi.stubEnv('MOBILE_APP_ANDROID_CERT_FINGERPRINTS', 'aa:bb');
    const res = await getAssetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const body = await res.json();
    expect(body[0].target.package_name).toBe('com.alga.psa.mobile');
    expect(body[0].target.sha256_cert_fingerprints).toEqual(['AA:BB']);
  });
});
