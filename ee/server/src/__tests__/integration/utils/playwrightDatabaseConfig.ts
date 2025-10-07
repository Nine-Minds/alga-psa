export type PlaywrightDbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
};

export const PLAYWRIGHT_DB_CONFIG: PlaywrightDbConfig = {
  host: process.env.PLAYWRIGHT_DB_HOST ?? 'localhost',
  port: Number(process.env.PLAYWRIGHT_DB_PORT ?? 5432),
  database: process.env.PLAYWRIGHT_DB_NAME ?? 'alga_contract_wizard_test',
  user: process.env.PLAYWRIGHT_DB_USER ?? 'postgres',
  password: process.env.PLAYWRIGHT_DB_PASSWORD ?? '',
  ssl: (process.env.PLAYWRIGHT_DB_SSL ?? '').toLowerCase() === 'true',
};

const truthy = (value: boolean) => (value ? 'true' : 'false');

export function applyPlaywrightDatabaseEnv(): void {
  process.env.DB_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_PORT = String(PLAYWRIGHT_DB_CONFIG.port);
  process.env.DB_NAME = PLAYWRIGHT_DB_CONFIG.database;
  process.env.DB_USER = PLAYWRIGHT_DB_CONFIG.user;
  process.env.DB_PASSWORD = PLAYWRIGHT_DB_CONFIG.password;
  process.env.DB_SSL = truthy(PLAYWRIGHT_DB_CONFIG.ssl);

  process.env.DB_HOST_SERVER = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_PORT_SERVER = String(PLAYWRIGHT_DB_CONFIG.port);
  process.env.DB_NAME_SERVER = PLAYWRIGHT_DB_CONFIG.database;
  process.env.DB_USER_SERVER = PLAYWRIGHT_DB_CONFIG.user;
  process.env.DB_PASSWORD_SERVER = PLAYWRIGHT_DB_CONFIG.password;

  process.env.DB_DIRECT_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_DIRECT_PORT = String(PLAYWRIGHT_DB_CONFIG.port);

  process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN ?? PLAYWRIGHT_DB_CONFIG.user;
  process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN ?? PLAYWRIGHT_DB_CONFIG.password;

  process.env.DB_USER_READONLY = process.env.DB_USER_READONLY ?? PLAYWRIGHT_DB_CONFIG.user;
  process.env.DB_PASSWORD_READONLY = process.env.DB_PASSWORD_READONLY ?? PLAYWRIGHT_DB_CONFIG.password;
}
