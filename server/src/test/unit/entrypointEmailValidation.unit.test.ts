import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const entrypoint = path.resolve(__dirname, '../../../entrypoint.sh');

// Source only the log() and validate_environment() functions (the script's own
// main would start the server), then run validation with the given environment.
function validate(env: Record<string, string>) {
  const script = `
    log() { echo "$1"; }
    eval "$(sed -n '/^validate_environment() {/,/^}/p' '${entrypoint}')"
    validate_environment
  `;
  return spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
}

const BASE_ENV = {
  DB_TYPE: 'postgres',
  DB_USER_ADMIN: 'postgres',
  LOG_LEVEL: 'INFO',
  LOG_IS_FORMAT_JSON: 'false',
  LOG_IS_FULL_DETAILS: 'false',
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SESSION_EXPIRES: '86400',
};

describe('server/entrypoint.sh validate_environment (system email is optional)', () => {
  it('passes with EMAIL_ENABLE unset and no EMAIL_* variables', () => {
    const result = validate(BASE_ENV);
    expect(result.stdout).toContain('Environment validation successful');
    expect(result.status).toBe(0);
  });

  it('passes with a Resend-only setup (no EMAIL_PORT / EMAIL_USERNAME)', () => {
    const result = validate({ ...BASE_ENV, RESEND_API_KEY: 're_x', EMAIL_FROM: 'noreply@example.com' });
    expect(result.status).toBe(0);
  });

  it('passes with EMAIL_ENABLE=false', () => {
    expect(validate({ ...BASE_ENV, EMAIL_ENABLE: 'false' }).status).toBe(0);
  });

  it('still rejects genuinely missing required variables', () => {
    const { NEXTAUTH_URL: _omit, ...rest } = BASE_ENV;
    const result = validate(rest);
    expect(result.status).not.toBe(0);
  });
});
