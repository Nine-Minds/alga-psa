import User from '@alga-psa/db/models/user';
import type { OAuthProfileMappingInput, OAuthProfileMappingResult } from './types';

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
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
    throw new Error('OAuth profile did not include an email address');
  }

  const user = await User.findUserByEmailAndType(normalizedEmail, 'internal');
  if (!user) {
    throw new Error('OAuth user is not authorized for MSP sign-in');
  }

  if (user.is_inactive) {
    throw new Error('OAuth user account is inactive');
  }

  if (user.user_type !== 'internal') {
    throw new Error('OAuth user is not an internal MSP account');
  }

  return {
    id: user.user_id,
    email: user.email,
    name: buildDisplayName(user),
    username: user.username || user.email,
    image: typeof input.image === 'string' ? input.image : user.image,
    proToken: user.hashed_password || '',
    tenant: user.tenant,
    user_type: 'internal',
  };
}
