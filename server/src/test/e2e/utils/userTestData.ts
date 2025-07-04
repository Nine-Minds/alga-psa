import { faker } from '@faker-js/faker';
import { hash } from 'bcryptjs';

/**
 * Create test user data
 */
export function createUserTestData(overrides: Partial<any> = {}) {
  const firstName = overrides.first_name || faker.person.firstName();
  const lastName = overrides.last_name || faker.person.lastName();
  const username = overrides.username || faker.internet.userName({ firstName, lastName }).toLowerCase();
  
  return {
    username,
    email: overrides.email || faker.internet.email({ firstName, lastName }).toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    password: overrides.password || 'TestPassword123!',
    user_type: overrides.user_type || faker.helpers.arrayElement(['employee', 'contractor', 'client', 'internal']),
    is_inactive: overrides.is_inactive ?? false,
    bio: overrides.bio || faker.lorem.sentence(),
    phone: overrides.phone || faker.phone.number(),
    mobile: overrides.mobile || faker.phone.number(),
    timezone: overrides.timezone || faker.helpers.arrayElement(['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC']),
    language: overrides.language || faker.helpers.arrayElement(['en', 'es', 'fr', 'de']),
    theme: overrides.theme || faker.helpers.arrayElement(['light', 'dark', 'system']),
    notification_preferences: overrides.notification_preferences || {
      email: true,
      sms: false,
      push: true,
      digest: 'daily'
    },
    tags: overrides.tags || [faker.word.noun(), faker.word.adjective()],
    ...overrides
  };
}

/**
 * Create test user with hashed password
 */
export async function createUserTestDataWithHashedPassword(overrides: Partial<any> = {}) {
  const userData = createUserTestData(overrides);
  const hashedPassword = await hash(userData.password, 10);
  
  return {
    ...userData,
    hashed_password: hashedPassword,
    password: undefined // Remove plain password
  };
}

/**
 * Create multiple test users
 */
export function createMultipleUsers(count: number) {
  return Array.from({ length: count }, () => createUserTestData());
}

/**
 * Create user with specific role
 */
export function createUserWithRole(role: string, overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    role,
    tags: [role, ...(overrides.tags || [])]
  });
}

/**
 * Create admin user
 */
export function createAdminUser(overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    username: overrides.username || 'admin_' + faker.string.alphanumeric(6),
    user_type: 'internal',
    is_admin: true,
    tags: ['admin', ...(overrides.tags || [])]
  });
}

/**
 * Create client user
 */
export function createClientUser(companyId: string, overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    user_type: 'client',
    company_id: companyId,
    tags: ['client', ...(overrides.tags || [])]
  });
}

/**
 * Create contractor user
 */
export function createContractorUser(overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    user_type: 'contractor',
    hourly_rate: faker.number.int({ min: 50, max: 200 }),
    tags: ['contractor', ...(overrides.tags || [])]
  });
}

/**
 * Create user preferences
 */
export function createUserPreferences(overrides: Partial<any> = {}) {
  return {
    dashboard_layout: faker.helpers.arrayElement(['grid', 'list', 'kanban']),
    default_project_view: faker.helpers.arrayElement(['board', 'timeline', 'calendar']),
    email_notifications: faker.datatype.boolean(),
    push_notifications: faker.datatype.boolean(),
    time_format: faker.helpers.arrayElement(['12h', '24h']),
    date_format: faker.helpers.arrayElement(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
    week_start: faker.helpers.arrayElement(['sunday', 'monday']),
    ...overrides
  };
}