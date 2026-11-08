import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [cli, config, report, ...filters] = process.argv.slice(2);
// Resolve from the registered runner so each workspace uses its own Vitest.
const { createVitest } = await import(pathToFileURL(createRequire(cli).resolve('vitest/node')).href);
const vitest = await createVitest('test', { config, watch: false, run: true });
try {
  const { testModules, unhandledErrors } = await vitest.collect(filters);
  const errors = [...unhandledErrors];
  for (const module of testModules) {
    errors.push(...module.errors());
    for (const suite of module.children.allSuites()) errors.push(...suite.errors());
  }
  if (errors.length) throw new AggregateError(errors, 'Vitest module collection failed');

  // The list CLI drops skipped cases. Inventory records registrations, including
  // suites skipped for unavailable services; it never proves test execution.
  const cases = testModules.flatMap(module => [...module.children.allTests()].map(test => ({
    file: module.moduleId,
    name: test.fullName,
    ...(test.project.name ? { projectName: test.project.name } : {}),
    skipped: test.result().state === 'skipped',
  })));
  writeFileSync(report, JSON.stringify(cases, null, 2));
} finally {
  await vitest.close();
}
