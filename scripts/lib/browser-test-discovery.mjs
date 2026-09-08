import { repositoryTestFiles, reconcileDiscovery } from './test-discovery.mjs';
import { playwrightTests } from './playwright-execution-evidence.mjs';

export const isBrowserTest = file => /\.playwright\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  || /^e2e-tests\/(tests|development-tests)\/.*\.spec\.[cm]?[jt]sx?$/.test(file);

export function discoverBrowserTests(root, reports, sourceRoot = root) {
  const collections = reports.map(({ runner, report, exitCode }) => {
    const tests = playwrightTests(report, sourceRoot);
    return { runner, status: exitCode === 0 ? 'passed' : 'failed',
      files: [...new Set(tests.map(test => test.file))], collectedTests: tests.length,
      disabledOrExpectedFailure: tests.filter(test => test.expectedStatus !== 'passed').length };
  });
  return { ...reconcileDiscovery({ root, candidates: repositoryTestFiles(root).filter(isBrowserTest), collections }),
    scope: 'browser-collection', executionVerified: false,
    collections: collections.map(collection => ({ ...collection, collectedFiles: collection.files.length })),
  };
}
