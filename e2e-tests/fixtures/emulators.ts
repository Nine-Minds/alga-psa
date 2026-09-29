import { test as authenticatedTest } from './auth';
import { EmulatorControl } from './emulator-control.mjs';

export const test = authenticatedTest.extend<{
  emulatorProviders: string[];
  emulators: EmulatorControl;
}>({
  emulatorProviders: [[], { option: true }],
  emulators: async ({ emulatorProviders }, use, testInfo) => {
    if (process.env.E2E_EMULATORS_ISOLATED !== 'true' || !process.env.ALGASIM_CONTROL_URL) {
      throw new Error('Provider journeys require E2E_EMULATORS_ISOLATED=true and ALGASIM_CONTROL_URL for a disposable algasim instance');
    }
    if (testInfo.config.workers !== 1) {
      throw new Error('A shared algasim instance requires one Playwright worker; allocate separate instances before parallelizing');
    }
    const controls = new EmulatorControl(process.env.ALGASIM_CONTROL_URL, emulatorProviders);
    try {
      await controls.reset();
      await use(controls);
    } finally {
      // Keep provider state available until the next scenario starts, so a
      // failure can be inspected. State views are attached explicitly by tests;
      // this default attachment contains no seed credentials or payload bodies.
      await testInfo.attach('emulator-evidence', {
        body: JSON.stringify(await controls.diagnostics(), null, 2), contentType: 'application/json',
      });
    }
  },
});

export { expect } from './auth';
