/**
 * Single source of truth for whether the environment-backed system email
 * provider exists.
 *
 * - `disabled`:     EMAIL_ENABLE is "false" (trimmed, case-insensitive).
 * - `unconfigured`: not disabled, but the credential for the resolved provider
 *                   type is missing (RESEND_API_KEY for resend, EMAIL_HOST for smtp).
 * - `configured`:   not disabled and credentials are present.
 *
 * EMAIL_ENABLE is an off switch only. Any other value (unset, empty, "true",
 * anything else) counts as "not disabled".
 */
export type SystemEmailProviderType = 'smtp' | 'resend';

export type SystemEmailState =
  | { state: 'disabled' }
  | { state: 'unconfigured' }
  | { state: 'configured'; providerType: SystemEmailProviderType };

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function resolveSystemEmailState(env: NodeJS.ProcessEnv = process.env): SystemEmailState {
  if ((env.EMAIL_ENABLE ?? '').trim().toLowerCase() === 'false') {
    return { state: 'disabled' };
  }

  const requested = (env.EMAIL_PROVIDER_TYPE ?? '').trim().toLowerCase();
  let providerType: SystemEmailProviderType;
  if (requested === 'resend') {
    providerType = 'resend';
  } else if (requested !== '') {
    // 'smtp' or any unrecognised name: the factory has always treated these as smtp.
    providerType = 'smtp';
  } else {
    providerType = isSet(env.RESEND_API_KEY) ? 'resend' : 'smtp';
  }

  const hasCredential = providerType === 'resend' ? isSet(env.RESEND_API_KEY) : isSet(env.EMAIL_HOST);
  return hasCredential ? { state: 'configured', providerType } : { state: 'unconfigured' };
}

/** Convenience for callers that only need a yes/no. */
export function isSystemEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSystemEmailState(env).state === 'configured';
}
