/**
 * Compatibility re-export of the shared runner-auth verification.
 *
 * The environment-neutral implementation lives in the shared server package at
 * `server/src/lib/extensions/runnerAuth.ts`. Keeping a re-export here preserves
 * the stable `@ee/lib/extensions/runnerAuth` import used by the internal
 * extension-runner host APIs while guaranteeing those routes and the extension
 * gateway execute exactly the same security logic.
 */
export {
  RunnerAuthError,
  assertRunnerAuth,
  isValidRunnerToken,
  resolveRunnerToken,
} from 'server/src/lib/extensions/runnerAuth';
