import { defineConfig } from '@playwright/test';
import localConfig from './playwright.local.config';

export default defineConfig({
  ...localConfig,
  testDir: './development-tests',
  testMatch: 'teams-profile.spec.ts',
  metadata: {
    ...localConfig.metadata,
    integrationSurface: 'teams',
    requiredServerNodeEnv: 'development',
    releaseValidation: false,
  },
});
