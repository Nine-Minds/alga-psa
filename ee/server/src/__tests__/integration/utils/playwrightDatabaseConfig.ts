type RawConfig = {
  host: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
  appUser: string;
  appPassword: string;
  ssl: boolean;
};

const secretsDbPassword = process.env.PLAYWRIGHT_DB_APP_PASSWORD ?? 'test-password';
const secretsAdminPassword = process.env.PLAYWRIGHT_DB_ADMIN_PASSWORD ?? 'test-password';

const DEFAULT_CONFIG: RawConfig = {
  host: process.env.PLAYWRIGHT_DB_HOST ?? 'localhost',
  port: Number(process.env.PLAYWRIGHT_DB_PORT ?? 5432),
  database: process.env.PLAYWRIGHT_DB_NAME ?? 'alga_contract_wizard_test',
  adminUser: process.env.PLAYWRIGHT_DB_ADMIN_USER ?? 'postgres',
  adminPassword: secretsAdminPassword,
  appUser: process.env.PLAYWRIGHT_DB_APP_USER ?? 'app_user',
  appPassword: secretsDbPassword,
  ssl: (process.env.PLAYWRIGHT_DB_SSL ?? '').toLowerCase() === 'true',
};

export const PLAYWRIGHT_DB_CONFIG = DEFAULT_CONFIG;

const truthy = (value: boolean) => (value ? 'true' : 'false');

export function applyPlaywrightDatabaseEnv(): void {
  // Primary connection (used by prisma/knex defaults)
  process.env.DB_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_PORT = String(PLAYWRIGHT_DB_CONFIG.port);
  process.env.DB_NAME = PLAYWRIGHT_DB_CONFIG.database;
  process.env.DB_SSL = truthy(PLAYWRIGHT_DB_CONFIG.ssl);

  // Application credentials
  process.env.DB_USER = PLAYWRIGHT_DB_CONFIG.appUser;
  process.env.DB_PASSWORD = PLAYWRIGHT_DB_CONFIG.appPassword;
  process.env.DB_USER_SERVER = PLAYWRIGHT_DB_CONFIG.appUser;
  process.env.DB_PASSWORD_SERVER = PLAYWRIGHT_DB_CONFIG.appPassword;
  process.env.DB_USER_HOCUSPOCUS = PLAYWRIGHT_DB_CONFIG.appUser;
  process.env.DB_PASSWORD_HOCUSPOCUS = PLAYWRIGHT_DB_CONFIG.appPassword;

  // Admin credentials for migrations/reset
  process.env.DB_USER_ADMIN = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.DB_PASSWORD_ADMIN = PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_PASSWORD_SUPERUSER = PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_USER_READONLY = process.env.DB_USER_READONLY ?? PLAYWRIGHT_DB_CONFIG.appUser;
  process.env.DB_PASSWORD_READONLY = process.env.DB_PASSWORD_READONLY ?? PLAYWRIGHT_DB_CONFIG.appPassword;

  // Server specific overrides
  process.env.DB_HOST_SERVER = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_PORT_SERVER = String(PLAYWRIGHT_DB_CONFIG.port);
  process.env.DB_NAME_SERVER = PLAYWRIGHT_DB_CONFIG.database;

  // Direct host/port for connections that bypass pgbouncer
  process.env.DB_DIRECT_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_DIRECT_PORT = String(PLAYWRIGHT_DB_CONFIG.port);

  // Provide fallbacks for scripts that expect secrets path variables
  process.env.POSTGRES_USER = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.POSTGRES_PASSWORD = PLAYWRIGHT_DB_CONFIG.adminPassword;
}
