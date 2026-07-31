/**
 * Baked-in public key registry for offline license verification.
 *
 * Each entry maps a `kid` (key id, carried in the JWT header) to a
 * PEM-encoded EC (P-256) public key. The private keys are held by Nine Minds
 * only and are never committed to this repository.
 *
 * To rotate: generate a new keypair, assign a new kid, add the public key
 * here, and update the signing CLI. Old kids continue to work until removed.
 *
 * kid naming convention: "v<N>" for production, "v<N>-test" for test fixtures.
 */
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
  /**
   * v1: initial production signing key.
   * Corresponding ES256 (P-256) private key is held by Nine Minds in Vault
   * (the alga-license signing service loads it at runtime; it is never committed).
   * public-key sha256(DER) fingerprint: 87b2f50be065f21fb1a8684f130c6b1571cd1da28253419bde2ae62b6801e6c6
   */
  'v1': `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEz+SFchVr1Y0Yp7RWngGyeCxBOFJK
gUyETxpmGwiPUM8mqwchE8pAyX8C7cZslf9XX609TYDSqQBq5sekERbcIw==
-----END PUBLIC KEY-----`,

  /**
   * v1-test: throwaway test keypair. ONLY for automated tests and local-dev
   * license services — do not issue real licenses with this kid. The private
   * key is intentionally NOT committed (a PEM private key trips secret
   * scanners); the fixture tokens in verify-license.test.ts are pre-signed
   * with it. To rotate the keypair and re-sign the fixtures, run
   * packages/licensing/scripts/gen-test-fixtures.mjs and paste its output
   * here and into the test files.
   */
  'v1-test': `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5Iq3v10oS9/9IMvc88Rau44Ri0dV
We8VqRV0D58tVtWXa28OyqciNLEOtbn9qlNBhmsuAHf6c5rwTXZqHhRAAA==
-----END PUBLIC KEY-----`,
};
