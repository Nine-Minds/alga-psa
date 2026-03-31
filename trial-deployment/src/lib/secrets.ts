import { randomBytes } from 'crypto';

export interface TrialSecrets {
  postgresPassword: string;
  dbPasswordServer: string;
  dbPasswordHocuspocus: string;
  redisPassword: string;
  cryptoKey: string;
  tokenSecretKey: string;
  nextauthSecret: string;
  algaAuthKey: string;
  /** The admin user password presented to the trial user */
  adminPassword: string;
}

function generateSecret(length: number = 32): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

export function generateTrialSecrets(): TrialSecrets {
  return {
    postgresPassword: generateSecret(24),
    dbPasswordServer: generateSecret(24),
    dbPasswordHocuspocus: generateSecret(24),
    redisPassword: generateSecret(24),
    cryptoKey: generateSecret(48),
    tokenSecretKey: generateSecret(48),
    nextauthSecret: generateSecret(48),
    algaAuthKey: generateSecret(48),
    adminPassword: generateSecret(16),
  };
}
