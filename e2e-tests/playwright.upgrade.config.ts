import { defineConfig } from '@playwright/test';
import config from './playwright.config';
// These journeys mutate retained billing and usage rows; retrying against the
// same upgraded database would obscure the first failure with changed state.
export default defineConfig({ ...config, testDir: './upgrade-tests', retries: 0 });
