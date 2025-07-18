import { faker } from '@faker-js/faker';

/**
 * Create test company data
 */
export function createCompanyTestData(overrides: Partial<any> = {}) {
  return {
    company_name: faker.company.name(),
    email: faker.internet.email(),
    phone_no: faker.phone.number(),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postal_code: faker.location.zipCode(),
    country: faker.location.countryCode(),
    url: faker.internet.url(),
    notes: faker.lorem.sentence(),
    is_inactive: false,
    tax_id_number: faker.string.alphanumeric(10),
    billing_cycle: faker.helpers.arrayElement(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']),
    tags: [faker.word.noun(), faker.word.adjective()],
    ...overrides
  };
}

/**
 * Create test company location data
 */
export function createCompanyLocationTestData(overrides: Partial<any> = {}) {
  return {
    location_name: faker.company.name() + ' ' + faker.helpers.arrayElement(['Office', 'Warehouse', 'Store']),
    address_line1: faker.location.streetAddress(),
    address_line2: faker.datatype.boolean() ? faker.location.secondaryAddress() : '',
    city: faker.location.city(),
    state_province: faker.location.state({ abbreviated: true }),
    postal_code: faker.location.zipCode(),
    country_code: faker.location.countryCode('alpha-2'),
    country_name: faker.location.country(),
    phone: faker.phone.number(),
    is_default: faker.datatype.boolean(),
    notes: faker.lorem.sentence(),
    ...overrides
  };
}

/**
 * Create multiple test companies
 */
export function createMultipleCompanies(count: number) {
  return Array.from({ length: count }, () => createCompanyTestData());
}

/**
 * Create company with specific attributes for testing
 */
export function createCompanyWithContacts() {
  const company = createCompanyTestData();
  const contacts = Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => ({
    full_name: faker.person.fullName(),
    email: faker.internet.email(),
    phone_number: faker.phone.number(),
    role: faker.person.jobTitle()
  }));
  
  return { company, contacts };
}

/**
 * Create company with locations
 */
export function createCompanyWithLocations() {
  const company = createCompanyTestData();
  const locations = Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, (_, index) => 
    createCompanyLocationTestData({ is_default: index === 0 })
  );
  
  return { company, locations };
}