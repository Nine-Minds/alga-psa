import { z } from 'zod';
import process from 'process';

const stripInlineComment = (val: unknown): string | undefined => {
  if (typeof val === 'string') {
    // Support inline comments in .env files, e.g. `DB_TYPE=postgres  # comment`
    // Only strip when comment delimiter is preceded by whitespace to avoid mangling values like URLs with fragments.
    const cleaned = val.replace(/\s[;#].*$/, '').trim();
    return cleaned === '' ? undefined : cleaned;
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return undefined;
};

// Helper functions for type coercion
const coerceNumber = (val: unknown): number | undefined => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.split(/[;#]/)[0].trim();
    const num = Number(cleaned);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
};

const coerceBoolean = (val: unknown): boolean | undefined => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const cleaned = val.split(/[;#]/)[0].trim().toLowerCase();
    if (cleaned === 'true' || cleaned === '1' || cleaned === 'yes') return true;
    if (cleaned === 'false' || cleaned === '0' || cleaned === 'no') return false;
    return undefined;
  }
  return undefined;
};

// App Schema
const appSchema = z.object({
  VERSION: z.string().default('0.0.0'),
  APP_NAME: z.string().default('sebastian'),
  HOST: z.string().default('localhost:3000'),
  APP_HOST: z.string().default('localhost:3000'),
  APP_ENV: z.preprocess(stripInlineComment, z.enum(['development', 'production', 'test'])).default('development'),
  VERIFY_EMAIL_ENABLED: z.preprocess(coerceBoolean, z.boolean()).default(true),
});

// Redis Schema
const redisSchema = z.object({
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.preprocess(coerceNumber, z.number().int().positive()).default(6379),
  REDIS_PASSWORD: z.string().optional(),
});

// Database Schema
const dbSchema = z.object({
  DB_TYPE: z.preprocess(stripInlineComment, z.literal('postgres')).default('postgres'),
  DB_HOST: z.preprocess(stripInlineComment, z.string()).default('localhost'),
  DB_PORT: z.preprocess(coerceNumber, z.number().int().positive()).default(5432),
  DB_NAME_HOCUSPOCUS: z.string().default('hocuspocus'),
  DB_USER_HOCUSPOCUS: z.string().default('hocuspocus_user'),
  DB_PASSWORD_HOCUSPOCUS: z.string().optional(), // Optional since using Docker secrets
  DB_NAME_SERVER: z.preprocess(stripInlineComment, z.string()).default('server'),
  DB_USER_SERVER: z.preprocess(stripInlineComment, z.string()).default('app_user'),
  DB_USER_ADMIN: z.preprocess(stripInlineComment, z.string()).default('postgres'),
  // Make password fields optional since they're managed via Docker secrets
  DB_PASSWORD_SERVER: z.string().optional(),
  DB_PASSWORD_ADMIN: z.string().optional(),
  DB_PASSWORD_SUPERUSER: z.string().optional(),
});

// Storage Schema
const storageSchema = z.object({
  STORAGE_LOCAL_BASE_PATH: z.string().default('/tmp/storage'),
  STORAGE_LOCAL_MAX_FILE_SIZE: z.preprocess(coerceNumber, z.number().int().positive()).default(104857600),
  STORAGE_LOCAL_ALLOWED_MIME_TYPES: z.string().default('*/*'),
  STORAGE_LOCAL_RETENTION_DAYS: z.preprocess(coerceNumber, z.number().int().positive()).default(30),
});

// Logging Schema
const logSchema = z.object({
  LOG_LEVEL: z
    .preprocess(stripInlineComment, z.enum(['SYSTEM', 'TRACE', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']))
    .default('SYSTEM'),
  LOG_IS_FORMAT_JSON: z.preprocess(coerceBoolean, z.boolean()).default(false),
  LOG_IS_FULL_DETAILS: z.preprocess(coerceBoolean, z.boolean()).default(false),
  LOG_ENABLE_FILE_LOGGING: z.preprocess(coerceBoolean, z.boolean()).default(true),
  LOG_DIR_PATH: z.string().default('./logs'),
  LOG_ENABLE_EXTERNAL_LOGGING: z.preprocess(coerceBoolean, z.boolean()).default(true),
  LOG_EXTERNAL_HTTP_HOST: z.string().default('localhost'),
  LOG_EXTERNAL_HTTP_PORT: z.string().default('8000'),
  LOG_EXTERNAL_HTTP_PATH: z.string().default('/print_info'),
  LOG_EXTERNAL_THTTP_LEVEL: z.string().default('info'),
  LOG_EXTERNAL_HTTP_TOKEN: z.string().optional(),
});

// Hocuspocus Schema
const hocuspocusSchema = z.object({
  HOCUSPOCUS_PORT: z.string().default('1234'),
});

// Email Schema
// const emailSchema = z.object({
//   EMAIL_ENABLE: z.preprocess(coerceBoolean, z.boolean()).default(true),
//   EMAIL_FROM: z.string().email().optional(),
//   EMAIL_HOST: z.string().optional(),
//   EMAIL_PORT: z.preprocess(coerceNumber, z.number().int().positive()).optional(),
//   EMAIL_USERNAME: z.string().email().optional(),
//   EMAIL_PASSWORD: z.string().optional(),
// });

// Crypto Schema
const cryptoSchema = z.object({
  ALGA_AUTH_KEY: z.string().optional(), // Optional since using Docker secrets
  SALT_BYTES: z.preprocess(coerceNumber, z.number().int().positive()).default(12),
  ITERATIONS: z.preprocess(coerceNumber, z.number().int().positive()).default(10000),
  KEY_LENGTH: z.preprocess(coerceNumber, z.number().int().positive()).default(64),
  ALGORITHM: z.string().default('sha512'),
});

// Token Schema
const tokenSchema = z.object({
  SECRET_KEY: z.string().optional(), // Optional since using Docker secrets
  TOKEN_EXPIRES: z.string().default('1h'),
});

// Auth Schema
const authSchema = z.object({
  NEXTAUTH_URL: z.preprocess(stripInlineComment, z.string().url()).default('http://localhost:3000'),
  NEXTAUTH_SECRET: z.string().optional(), // Required as environment variable
  NEXTAUTH_SESSION_EXPIRES: z.preprocess(coerceNumber, z.number().int().positive()).default(86400),
});

// Google Auth Schema
const googleAuthSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
});

// Anthropic Schema
const anthropicSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
});

// Combined Environment Schema
const envSchema = z.object({
  ...appSchema.shape,
  ...redisSchema.shape,
  ...dbSchema.shape,
  ...storageSchema.shape,
  ...logSchema.shape,
  ...hocuspocusSchema.shape,
  // ...emailSchema.shape,
  ...cryptoSchema.shape,
  ...tokenSchema.shape,
  ...authSchema.shape,
  ...googleAuthSchema.shape,
  ...anthropicSchema.shape,
});

export type EnvConfig = z.infer<typeof envSchema>;

// ANSI color codes for better readability
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function categorizeError(path: (string | number)[]) {
  const key = path[0] as string;
  if (key.startsWith('DB_')) return 'Database';
  if (key.startsWith('EMAIL_')) return 'Email';
  if (key.startsWith('REDIS_')) return 'Redis';
  if (key.startsWith('STORAGE_')) return 'Storage';
  if (key.startsWith('LOG_')) return 'Logging';
  if (key.startsWith('NEXTAUTH_')) return 'Authentication';
  if (key.startsWith('GOOGLE_')) return 'Google OAuth';
  if (key.startsWith('ANTHROPIC_')) return 'AI Services';
  return 'Other';
}

export class EnvValidationError extends Error {
  constructor(public errors: z.ZodError) {
    // Group errors by category
    const errorsByCategory = errors.errors.reduce((acc, err) => {
      const category = categorizeError(err.path);
      if (!acc[category]) acc[category] = [];
      acc[category].push(err);
      return acc;
    }, {} as Record<string, typeof errors.errors>);

    // Format the error message
    let message = `${colors.bold}${colors.red}Environment Validation Failed${colors.reset}\n`;
    message += `${colors.yellow}Please check your .env file and ensure all required variables are set correctly.${colors.reset}\n\n`;

    // Add errors by category
    Object.entries(errorsByCategory).forEach(([category, categoryErrors]) => {
      message += `${colors.bold}${colors.cyan}${category}:${colors.reset}\n`;
      categoryErrors.forEach(err => {
        message += `  ${colors.red}•${colors.reset} ${err.path.join('.')}: ${err.message}\n`;
      });
      message += '\n';
    });

    super(message);
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(): EnvConfig {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new EnvValidationError(error);
    }
    throw error;
  }
}

// Export the validation function and types, but don't run validation at module load
export default validateEnv;
