if (typeof window !== 'undefined') {
  // CI runs the affected nx projects in parallel, so a saturated runner can
  // stretch renders past testing-library's 1s default async timeout (waitFor,
  // findBy*) and flake component suites that pass everywhere else. Configure
  // through the react entry point as well: @testing-library/react ships its
  // own nested copy of @testing-library/dom, so configuring only the top-level
  // dom package leaves the copy react actually uses at the 1s default.
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 10_000 });
  const { configure: configureReact } = await import('@testing-library/react');
  configureReact({ asyncUtilTimeout: 10_000 });
}
