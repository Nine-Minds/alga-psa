import { defineConfig } from '@playwright/test';
import localConfig from './playwright.local.config';

export default defineConfig({
  ...localConfig,
  testDir: './development-tests',
  testMatch: 'teams-profile.spec.ts',
  // Desktop Chrome is 1280x720. This lane forces release-v1-6-feature and runs
  // the enterprise development build, so the Microsoft profile dialog renders
  // more capability rows than the production lane sees -- enough that the first
  // one (msp_sso) sits below the fold. Playwright reported it visible, enabled
  // and stable but "outside of the viewport" after scrolling, because the dialog
  // overflows the window rather than scrolling internally. Give this lane a
  // taller window instead of forcing the click, which would assert on an element
  // a real user at this size also could not reach.
  projects: (localConfig.projects ?? []).map(project => ({
    ...project,
    use: { ...project.use, viewport: { width: 1280, height: 1200 } },
  })),
  metadata: {
    ...localConfig.metadata,
    integrationSurface: 'teams',
    requiredServerNodeEnv: 'development',
    releaseValidation: false,
  },
});
