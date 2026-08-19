/**
 * Localization boundary for server-action errors.
 *
 * `actionError('…', 'msp/clients:errors.duplicateName')` stays synchronous and returns
 * English. This runs once on the way out of `withAuth` / `withOptionalAuth` and rewrites
 * the message to the caller's locale, so no render site changes and no call site grows
 * an `await`.
 *
 * Two properties worth keeping:
 *  - **No-op without a key.** Payloads that carry no `messageKey` — every un-migrated
 *    action — are returned untouched, so enabling this changes nothing until the first
 *    key is passed.
 *  - **Idempotent.** `messageKey` stays on the payload after translating, so a wrapped
 *    action calling another wrapped action translates once per key rather than trying to
 *    translate an already-translated string.
 *
 * Outside a request scope (workflow workers, pg-boss jobs) `getServerTranslation` falls
 * back to the default locale rather than throwing, so the payload degrades to English.
 */

import {
  getActionErrorMessageKey,
  getActionErrorMessageParams,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageParams,
} from '@alga-psa/ui/lib/errorHandling';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

const DEFAULT_NAMESPACE = 'common';

/** Splits `'msp/clients:errors.x'` into its namespace and key. */
function splitNamespacedKey(messageKey: string): { namespace: string; key: string } {
  const separator = messageKey.lastIndexOf(':');
  if (separator === -1) {
    return { namespace: DEFAULT_NAMESPACE, key: messageKey };
  }
  return { namespace: messageKey.slice(0, separator), key: messageKey.slice(separator + 1) };
}

async function translate(
  messageKey: string,
  fallback: string,
  params: ActionMessageParams | undefined,
): Promise<string> {
  const { namespace, key } = splitNamespacedKey(messageKey);
  try {
    const { t } = await getServerTranslation(undefined, namespace);
    const translated = t(key, { defaultValue: fallback, ...(params ?? {}) });
    return typeof translated === 'string' && translated ? translated : fallback;
  } catch {
    // Never let a missing locale file turn a business-rule error into a crash.
    return fallback;
  }
}

/**
 * Rewrites an action-error payload's message into the caller's locale.
 * Anything that is not a keyed action error is returned as-is.
 */
export async function localizeActionError<T>(result: T): Promise<T> {
  const messageKey = getActionErrorMessageKey(result);
  if (!messageKey) {
    return result;
  }
  const messageParams = getActionErrorMessageParams(result);

  if (isActionMessageError(result)) {
    return { ...result, actionError: await translate(messageKey, result.actionError, messageParams) } as T;
  }

  if (isActionPermissionError(result)) {
    return { ...result, permissionError: await translate(messageKey, result.permissionError, messageParams) } as T;
  }

  return result;
}
