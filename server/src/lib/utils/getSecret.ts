import fs from 'fs';
import path from 'path';

// Calculate secrets directory path once at module load
const DOCKER_SECRETS_PATH = '/run/secrets';
const LOCAL_SECRETS_PATH = '../secrets';
const SECRETS_PATH = fs.existsSync(DOCKER_SECRETS_PATH) ? DOCKER_SECRETS_PATH : LOCAL_SECRETS_PATH;

console.log('SECRETS_PATH', SECRETS_PATH);

/**
 * Gets a secret value from either a Docker secret file or environment variable
 * @param secretName - Name of the secret (e.g. 'postgres_password')
 * @param envVar - Name of the fallback environment variable
 * @param defaultValue - Optional default value if neither source exists
 * @returns The secret value as a string
 */
export function getSecret(secretName: string, envVar: string, defaultValue: string = ''): string {
  const secretPath = path.join(SECRETS_PATH, secretName);
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (error) {
    if (process.env[envVar]) {
      console.warn(`Using ${envVar} environment variable instead of Docker secret`);
      return process.env[envVar] || defaultValue;
    }
    console.warn(`Neither secret file ${secretPath} nor ${envVar} environment variable found, using default value`);
    return defaultValue;
  }
}
  }
}
  }
}
