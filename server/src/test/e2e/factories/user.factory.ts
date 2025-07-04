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
    email: input.email || faker.internet.email().toLowerCase(),
    username: input.username || faker.internet.username(),
    first_name: input.firstName || faker.person.firstName(),
    last_name: input.lastName || faker.person.lastName(),
    hashed_password: 'hashed_password_test',
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    user_type: input.user_type || 'internal',
    created_at: new Date()
  };

  const result = await db.query(
    `INSERT INTO users (
      user_id, tenant, email, username, 
      first_name, last_name, hashed_password, 
      is_inactive, user_type, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
    ) RETURNING *`,
    [
      user.user_id,
      user.tenant,
      user.email,
      user.username,
      user.first_name,
      user.last_name,
      user.hashed_password,
      user.is_inactive,
      user.user_type,
      user.created_at
    ]
  );

  return result.rows[0];
}