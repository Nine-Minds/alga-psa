export { default } from './lib/logger';
// Mirror the named exports too: the package `exports` map points this subpath at
// dist/lib/logger.js, but tsconfig `paths` resolves it here, so this shim has to
// carry the same surface or the types disagree with the runtime module.
export { resolveLogLevel, logLevels } from './lib/logger';
export type { LogLevelName } from './lib/logger';
