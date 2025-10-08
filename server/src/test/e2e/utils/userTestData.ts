import { faker } from '@faker-js/faker';
import { hash } from 'bcryptjs';

/**
 * Create test user data
 */
export function createUserTestData(overrides: Partial<any> = {}) {
  const firstName = overrides.first_name || faker.person.firstName();
  const lastName = overrides.last_name || faker.person.lastName();
  const username = overrides.username || faker.internet.username({ firstName, lastName }).toLowerCase();
  
  const baseData = {
    username,
    email: overrides.email || faker.internet.email({ firstName, lastName }).toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    password: overrides.password || 'TestPassword123!',
    user_type: overrides.user_type || faker.helpers.arrayElement(['internal', 'client']),
    is_inactive: overrides.is_inactive ?? false,
    phone: overrides.phone || '+1-555-123-4567',
    timezone: overrides.timezone || faker.helpers.arrayElement(['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London']),
  };
  
  // Only include valid schema fields for API calls
  const validFields = ['username', 'email', 'first_name', 'last_name', 'password', 'user_type', 
                      'is_inactive', 'phone', 'timezone', 'contact_id', 'two_factor_enabled', 
                      'is_google_user', 'role_ids'];
  
  const result: any = {};
  for (const key of validFields) {
    if (key in baseData || key in overrides) {
      result[key] = overrides[key] !== undefined ? overrides[key] : (baseData as any)[key];
    }
  }
  
  return result;
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
    ...overrides
  });
}

/**
 * Create admin user
 */
export function createAdminUser(overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    username: overrides.username || 'admin_' + faker.string.alphanumeric(6),
    user_type: 'internal'
  });
}

/**
 * Create client user
 */
export function createClientUser(clientId: string, overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    user_type: 'client'
  });
}

/**
 * Create contractor user
 */
export function createContractorUser(overrides: Partial<any> = {}) {
  return createUserTestData({
    ...overrides,
    user_type: 'contractor'
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