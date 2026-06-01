/**
 * Appliance license seat enforcement — Enterprise Edition only.
 *
 * Community Edition stub: CE has no appliance licensing, so it never limits
 * seats. The real implementation (resolved via `@enterprise/lib/license/userSeatGuard`
 * on EE builds) lives in `ee/server/src/lib/license/userSeatGuard.ts`.
 */
export async function checkApplianceLicenseSeatLimit(
  _usedSeats: number
): Promise<{ seats: number } | null> {
  return null;
}
