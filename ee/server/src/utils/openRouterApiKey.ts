import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import dotenv from 'dotenv';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

export async function getOpenRouterApiKey(): Promise<string | null> {
  const secretProvider = await getSecretProviderInstance();
  const fromSecrets = await secretProvider.getAppSecret('OPENROUTER_API_KEY');
  if (fromSecrets) {
    return fromSecrets;
  }

  const fromEnv = process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API;
  if (fromEnv) {
    if (!process.env.OPENROUTER_API_KEY) {
      process.env.OPENROUTER_API_KEY = fromEnv;
    }
    return fromEnv;
  }

  const home = os.homedir?.();
  if (!home) {
    return null;
  }

  const envPath = path.join(home, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const parsed = dotenv.parse(raw);
    const key = parsed.OPENROUTER_API_KEY ?? parsed.OPENROUTER_API;
    if (key) {
      process.env.OPENROUTER_API_KEY = key;
      process.env.OPENROUTER_API = key;
      return key;
    }
  } catch {
    // Intentionally ignore missing/unreadable ~/.env
  }

  return null;
}
