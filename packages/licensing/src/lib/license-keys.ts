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
   * Corresponding private key is held by Nine Minds (not in this repo).
   */
  'v1': `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2Jqnmqjb2akeRovfGxeYQQkhwdVu
w+XSD+4BU0TGN1T0O/xc6IpIjnnxZ+FIDbgMjUP2VO1FMly5BDLsMOejKA==
-----END PUBLIC KEY-----`,

  /**
   * v1-test: throwaway test keypair committed to the repo.
   * ONLY for automated tests — do not issue real licenses with this kid.
   * Private key: packages/licensing/src/lib/__test-fixtures__/v1-test.private.pem
   */
  'v1-test': `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEv1wbPfZJVePUOzgtwSOaKN5dWDWX
sPkVRg54g4JlA9v0gM0bdImyAKsfIqwuTt3ouXgCtnMFf9WoYVGD0/fBdA==
-----END PUBLIC KEY-----`,
};
