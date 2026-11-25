import { fileURLToPath } from 'node:url';

// Vitest executes server actions in-process, even in jsdom component suites;
// it does not apply Next.js's server-action/RPC transform. Resolve only the
// build-time marker to its server entry, without changing React's conditions
// or mocking any server implementation. Never use this in application builds.
export const serverOnlyAlias = {
  find: /^server-only$/,
  replacement: fileURLToPath(new URL('../../node_modules/server-only/empty.js', import.meta.url)),
};
