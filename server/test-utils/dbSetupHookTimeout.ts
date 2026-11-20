// Hook budget for vitest suites whose beforeAll recreates a disposable database
// (DROP + CREATE ... TEMPLATE). Postgres can hold each statement for up to 5s
// while sessions from the previous file drain, so vitest's 10s default is too
// tight on a busy runner. Shared by the CE server and EE integration configs.
//
// Kept free of vitest imports so configs from other projects (and tests that
// pin the budget) can import it without typechecking another project's config.
export const DB_SETUP_HOOK_TIMEOUT_MS = 120_000;
