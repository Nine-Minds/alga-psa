import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TrackingDestination {
  tenant: string;
  enrollmentId: string;
  stepId: string;
  url: string;
}

/**
 * HMAC signature binding a click-tracking destination to its tenant,
 * enrollment, and step. Minted at send time; the public click redirect
 * refuses any destination whose signature does not verify, closing the
 * open-redirect (nobody can hand-craft phishing links on the MSP's domain).
 * Pure — the caller supplies the secret.
 */
export function signTrackingDestination(secret: string, dest: TrackingDestination): string {
  return createHmac('sha256', secret)
    .update(`${dest.tenant}\n${dest.enrollmentId}\n${dest.stepId}\n${dest.url}`)
    .digest('hex');
}

export function verifyTrackingDestination(
  secret: string,
  dest: TrackingDestination,
  signature: string,
): boolean {
  const expected = Buffer.from(signTrackingDestination(secret, dest), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(expected, provided);
}
