# Feature Flag Checker Runtime Design

## Problem

Server feature checks in vertical packages call `isFeatureFlagEnabled` from
`@alga-psa/core`. The server registers the PostHog-backed checker during
application initialization.

In the production webpack build, the registry's module-local `_checker` state is
not shared across independently bundled routes. Webpack tree-shakes route-local
copies of `isFeatureFlagEnabled` to the no-checker fallback, so the marketing
route always reports `marketing-module` as disabled even when PostHog enables it
for the tenant.

## Design

Store the checker in a process-wide registry:

```ts
const FEATURE_FLAG_CHECKER_KEY = Symbol.for('alga.core.featureFlagChecker');
```

`registerFeatureFlagChecker` writes the checker to `globalThis` using that key.
`isFeatureFlagEnabled` reads it from `globalThis` for every evaluation. This
matches the existing `jobEnqueue` dependency-injection seam and prevents
route-local module copies from owning isolated checker state.

The current behavior remains unchanged when no checker is registered:

- Global feature-flag bypass still returns `true`.
- Missing checker still returns `false`.
- Checker errors and fallback behavior remain the responsibility of the
  registered PostHog runtime.

## Alternatives

- Import the server PostHog implementation directly from feature packages:
  rejected because it restores the vertical-package-to-server dependency cycle.
- Pass a checker into every marketing action:
  rejected because it changes many call sites and solves only marketing rather
  than the shared registry defect.

## Tests

- Register a checker, reset the module registry, import `features` again, and
  verify the new module instance can call the registered checker.
- Verify the checker receives the original flag key and context.
- Retain the existing tests for both global feature-flag bypass variables.
- Verify an unregistered checker remains fail-closed.

## Deployment

Build the application from the fix commit with webpack, deploy it to Sebastian
green, and verify the deployed marketing route bundle retains a `globalThis`
lookup rather than a constant-false implementation. Confirm the Nine Minds LLC
tenant can pass the server flag boundary before promoting traffic.
