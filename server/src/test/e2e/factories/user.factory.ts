/**
 * User Factory for E2E Tests
 * Creates user test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface UserInput {
  tenant: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  is_inactive?: boolean;
  user_type?: 'internal' | 'external';
}

export async function userFactory(db: any, input: UserInput) {
  const user = {
    user_id: faker.string.uuid(),
    tenant: input.tenant,
    email: input.email?.toLowerCase() || faker.internet.email().toLowerCase(),
    username: input.username?.toLowerCase() || faker.internet.username().toLowerCase(),
    first_name: input.firstName || faker.person.firstName(),
    last_name: input.lastName || faker.person.lastName(),
    hashed_password: 'hashed_password_test',
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    user_type: input.user_type || 'internal',
    created_at: new Date()
  };

  const result = await db('users')
    .insert({
      user_id: user.user_id,
      tenant: user.tenant,
      email: user.email,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      hashed_password: user.hashed_password,
      is_inactive: user.is_inactive,
      user_type: user.user_type,
      created_at: user.created_at
    })
    .returning('*');

  return result[0];
}