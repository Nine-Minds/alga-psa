import { describe, expect, it } from 'vitest';

/**
 * CIMD client-id SSRF hardening (plan test T012). Pure address/URL checks — no
 * DNS or network needed for the cases asserted here (IP literals + early scheme/
 * host rejections), so this runs offline and deterministically.
 */
import { isPrivateAddress, assertPublicHttpsUrl, ClientResolutionError } from '@ee/lib/mcp/oauth/clients';

describe('isPrivateAddress', () => {
  it('flags private / loopback / link-local IPv4', () => {
    for (const a of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '0.0.0.0']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
  });
  it('flags loopback / unique-local / link-local IPv6', () => {
    for (const a of ['::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});

describe('assertPublicHttpsUrl (T012)', () => {
  it('rejects non-https schemes', async () => {
    await expect(assertPublicHttpsUrl('http://claude.ai/x')).rejects.toBeInstanceOf(ClientResolutionError);
  });
  it('rejects embedded credentials', async () => {
    await expect(assertPublicHttpsUrl('https://user:pass@claude.ai/x')).rejects.toBeInstanceOf(ClientResolutionError);
  });
  it('rejects localhost / internal hostnames', async () => {
    await expect(assertPublicHttpsUrl('https://localhost/x')).rejects.toBeInstanceOf(ClientResolutionError);
    await expect(assertPublicHttpsUrl('https://svc.internal/x')).rejects.toBeInstanceOf(ClientResolutionError);
    await expect(assertPublicHttpsUrl('https://db.local/x')).rejects.toBeInstanceOf(ClientResolutionError);
  });
  it('rejects private IP literals (no DNS rebinding to internal)', async () => {
    await expect(assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(ClientResolutionError);
    await expect(assertPublicHttpsUrl('https://10.0.0.5/x')).rejects.toBeInstanceOf(ClientResolutionError);
  });
  it('allows a public https IP literal', async () => {
    const url = await assertPublicHttpsUrl('https://8.8.8.8/.well-known/oauth-client');
    expect(url.protocol).toBe('https:');
  });
});
