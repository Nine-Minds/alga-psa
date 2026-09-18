/**
 * Deny-by-default gate for the one 3CX emulator override: an `http://` PBX
 * base URL. Real PBXs are always HTTPS; only the local emulator on
 * localhost:4070 is plain HTTP, and production is a hard second lock.
 */
const ENABLED_VALUES = new Set(['true', '1']);

export function isThreecxEmulatorModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const raw = process.env.THREECX_EMULATOR_MODE?.trim().toLowerCase();
  return raw !== undefined && ENABLED_VALUES.has(raw);
}
