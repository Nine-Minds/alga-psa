import {
  DEFAULT_PAYMENT_SETTINGS,
  type PaymentSettings,
} from '../interfaces/payment.interfaces';

/**
 * Payment settings as persisted: the known settings plus any keys we do not
 * recognise (kept so a merge never silently drops stored data).
 */
export type StoredPaymentSettings = PaymentSettings & Record<string, unknown>;

function toPlainObject(value: unknown): Record<string, unknown> | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate as Record<string, unknown>;
}

/**
 * Single merge point for payment settings:
 * `{ ...DEFAULT_PAYMENT_SETTINGS, ...stored, ...patch }`.
 *
 * `stored` may be null/undefined, a JSON string (as some drivers return JSONB),
 * or an object. Anything null, non-object or unparseable yields the defaults.
 * Unknown keys in `stored` are preserved; explicit `patch` values win.
 */
export function mergePaymentSettings(
  stored: unknown,
  patch?: Partial<PaymentSettings>
): StoredPaymentSettings {
  const storedObject = toPlainObject(stored) ?? {};
  return {
    ...DEFAULT_PAYMENT_SETTINGS,
    ...storedObject,
    ...(patch ?? {}),
  } as StoredPaymentSettings;
}
