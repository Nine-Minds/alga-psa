import type { Page } from '@playwright/test';
import knex, { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { encode } from '@auth/core/jwt';

// Database configuration
export function getTestDbConfig() {
  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'ticket_response_state_test',
      user: process.env.DB_USER_SERVER || process.env.DB_USER || 'app_user',
      password: process.env.DB_PASSWORD_SERVER || process.env.DB_PASSWORD || 'postpass123',
    },
    pool: { min: 0, max: 5 },
  };
}

export function createTestDbConnection(): Knex {
  const config = getTestDbConfig();
  console.log('Database config:', {
    host: config.connection.host,
    port: config.connection.port,
    database: config.connection.database,
    user: config.connection.user,
    password: `[${config.connection.password?.length || 0} chars]`,
  });
  return knex(config);
}

// Environment setup
export function applyTestEnvDefaults(): void {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  process.env.E2E_AUTH_BYPASS = process.env.E2E_AUTH_BYPASS || 'true';
}

export function getBaseUrl(): string {
  return process.env.BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

// Tenant data types
export interface TenantTestData {
  tenant: {
    tenantId: string;
    tenantName: string;
  };
  adminUser: {
    userId: string;
    email: string;
  };
  client?: {
    clientId: string;
    clientName: string;
  };
}

// Create a test tenant with admin user
export async function createTestTenant(
  db: Knex,
  options: { companyName?: string } = {}
): Promise<TenantTestData> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const companyName = options.companyName || `Test Company ${uuidv4().slice(0, 6)}`;

  // Create tenant
  await db('tenants').insert({
    tenant: tenantId,
    client_name: companyName,
    email: `admin-${tenantId.slice(0, 8)}@test.com`,
  });

  // Create user
  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: `admin-${tenantId.slice(0, 8)}`,
    email: `admin-${tenantId.slice(0, 8)}@test.com`,
    first_name: 'Test',
    last_name: 'Admin',
    user_type: 'internal',
    is_inactive: false,
    hashed_password: 'not-a-real-hash',
  });

  // Create admin role with full permissions
  const roleId = uuidv4();
  await db('roles').insert({
    role_id: roleId,
    tenant: tenantId,
    role_name: 'Test Admin',
    description: 'Full admin role for testing',
    msp: true,
    client: false,
  });

  // Create permissions for ticket operations
  const ticketPermissions = ['read', 'create', 'update', 'delete'];
  const permissionIds: string[] = [];

  for (const action of ticketPermissions) {
    const permissionId = uuidv4();
    permissionIds.push(permissionId);
    await db('permissions').insert({
      permission_id: permissionId,
      tenant: tenantId,
      resource: 'ticket',
      action,
      msp: true,
      client: false,
    });
  }

  // Also add client and user permissions that might be needed
  const additionalResources = [
    { resource: 'client', actions: ['read'] },
    { resource: 'user', actions: ['read'] },
  ];

  for (const { resource, actions } of additionalResources) {
    for (const action of actions) {
      const permissionId = uuidv4();
      permissionIds.push(permissionId);
      await db('permissions').insert({
        permission_id: permissionId,
        tenant: tenantId,
        resource,
        action,
        msp: true,
        client: false,
      });
    }
  }

  // Assign permissions to role
  for (const permissionId of permissionIds) {
    await db('role_permissions').insert({
      tenant: tenantId,
      role_id: roleId,
      permission_id: permissionId,
    });
  }

  // Assign role to user
  await db('user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: roleId,
  });

  // Create client
  await db('clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: companyName,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create tenant settings
  await db('tenant_settings').insert({
    tenant: tenantId,
    onboarding_completed: true,
    onboarding_completed_at: new Date(),
  }).onConflict('tenant').ignore();

  // Create email settings (skip if not needed - table has different schema now)
  // The tenant_email_settings table now uses 'tenant' (uuid) column

  // Link tenant to client
  await db('tenant_companies').insert({
    tenant: tenantId,
    client_id: clientId,
    is_default: true,
  }).onConflict(['tenant', 'client_id']).ignore();

  return {
    tenant: {
      tenantId,
      tenantName: companyName,
    },
    adminUser: {
      userId,
      email: `admin-${tenantId.slice(0, 8)}@test.com`,
    },
    client: {
      clientId,
      clientName: companyName,
    },
  };
}

// Set up authenticated session for Playwright
export async function setupAuthSession(
  page: Page,
  tenantData: TenantTestData,
  baseUrl: string
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const cookieName = 'authjs.session-token'; // Dev mode cookie name
  const maxAge = 60 * 60 * 24; // 24 hours
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    sub: tenantData.adminUser.userId,
    id: tenantData.adminUser.userId,
    email: tenantData.adminUser.email,
    tenant: tenantData.tenant.tenantId,
    user_type: 'internal',
    name: 'Test Admin',
    proToken: 'playwright-mock-token',
    iat: now,
    exp: now + maxAge,
  };

  // Use NextAuth's encode function with the same salt as the cookie name
  const token = await encode({
    token: payload,
    secret,
    maxAge,
    salt: cookieName,
  });

  // Add session cookie
  await page.context().addCookies([
    {
      name: cookieName,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  console.log('[Test Auth] Session cookie set');
}

// Combined helper to create tenant and set up auth
export async function createTenantAndLogin(
  db: Knex,
  page: Page,
  options: {
    companyName?: string;
    baseUrl?: string;
  } = {}
): Promise<TenantTestData> {
  const tenantData = await createTestTenant(db, { companyName: options.companyName });
  await setupAuthSession(page, tenantData, options.baseUrl || getBaseUrl());
  return tenantData;
}

// Set up authenticated session for client user
export async function setupClientAuthSession(
  page: Page,
  userId: string,
  email: string,
  tenantId: string,
  _baseUrl: string
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const cookieName = 'authjs.session-token'; // Dev mode cookie name
  const maxAge = 60 * 60 * 24; // 24 hours
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    sub: userId,
    id: userId,
    email: email,
    tenant: tenantId,
    user_type: 'client',
    name: 'Test Client',
    proToken: 'playwright-mock-token',
    iat: now,
    exp: now + maxAge,
  };

  // Use NextAuth's encode function with the same salt as the cookie name
  const token = await encode({
    token: payload,
    secret,
    maxAge,
    salt: cookieName,
  });

  // Add session cookie
  await page.context().addCookies([
    {
      name: cookieName,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  console.log('[Test Auth] Client session cookie set');
}

// Create client user with proper permissions
export async function createClientUser(
  db: Knex,
  tenantId: string,
  clientId: string
): Promise<{ userId: string; email: string; contactId: string }> {
  const userId = uuidv4();
  const contactId = uuidv4();
  const email = `client-${tenantId.slice(0, 8)}@test.com`;

  // Create contact first (user_id is in users table, not contacts)
  await db('contacts').insert({
    contact_name_id: contactId,
    tenant: tenantId,
    full_name: 'Test Client Contact',
    email,
    created_at: new Date(),
    updated_at: new Date(),
    is_inactive: false,
    client_id: clientId,
  });

  // Create user with contact_id referencing the contact
  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: `client-${tenantId.slice(0, 8)}`,
    email,
    first_name: 'Test',
    last_name: 'Client',
    user_type: 'client',
    is_inactive: false,
    hashed_password: 'not-a-real-hash',
    contact_id: contactId,
  });

  // Create client role with appropriate permissions
  const roleId = uuidv4();
  await db('roles').insert({
    role_id: roleId,
    tenant: tenantId,
    role_name: 'Client User',
    description: 'Client role for testing',
    msp: false,
    client: true,
  });

  // Create ticket read permission for clients
  const permissionId = uuidv4();
  await db('permissions').insert({
    permission_id: permissionId,
    tenant: tenantId,
    resource: 'ticket',
    action: 'read',
    msp: false,
    client: true,
  });

  // Assign permission to role
  await db('role_permissions').insert({
    tenant: tenantId,
    role_id: roleId,
    permission_id: permissionId,
  });

  // Assign role to user
  await db('user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: roleId,
  });

  return { userId, email, contactId };
}
