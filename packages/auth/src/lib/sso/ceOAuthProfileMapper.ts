import User from '@alga-psa/db/models/user';
import type {
  OAuthMappingFailureCode,
  OAuthProfileMappingInput,
  OAuthProfileMappingResult,
} from './types';

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

// Throwing here would surface as Auth.js `error=Configuration`; report the
// reason as data so `callbacks.signIn` can redirect with a readable message.
function buildAuthFailureResult(
  code: OAuthMappingFailureCode,
  providerEmail?: string,
): OAuthProfileMappingResult {
  return {
    id: '',
    email: '',
    name: '',
    username: '',
    proToken: '',
    user_type: 'internal',
    authFailure: { code, providerEmail, userType: 'internal' },
  };
}

function buildDisplayName(user: {
  first_name?: string;
  last_name?: string;
  username: string;
  email: string;
}): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || user.username || user.email;
}

export async function mapCeOAuthProfileToExtendedUser(
  input: OAuthProfileMappingInput
): Promise<OAuthProfileMappingResult> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    return buildAuthFailureResult('missing_email');
  }

  const user = await User.findUserByEmailAndType(normalizedEmail, 'internal');
  if (!user) {
    return buildAuthFailureResult('no_matching_user', normalizedEmail);
  }

  if (user.is_inactive) {
    return buildAuthFailureResult('inactive_user', normalizedEmail);
  }

  if (user.user_type !== 'internal') {
    return buildAuthFailureResult('user_type_mismatch', normalizedEmail);
  }

  return {
    id: user.user_id,
    email: user.email,
    name: buildDisplayName(user),
    username: user.username || user.email,
    image: typeof input.image === 'string' ? input.image : user.icon,
    proToken: user.hashed_password || '',
    tenant: user.tenant,
    user_type: 'internal',
  };
}
