/**
 * CM L4c: standalone runner for the DB-backed task-conversation cases. The same registrations are hooked into
 * projectTaskCommentThreading.integration.test.ts; this file exists so the audience truth table and the requester
 * cases can be re-run on their own (that file's module graph needs the zod 4 build of event-schemas).
 *
 * Run against a migrated database, e.g.:
 *   L3C_DB_PORT=<port> TEST_DB_NAME=<db> npx vitest run src/test/integration/coManagedTaskConversations.integration.test.ts
 */
import { registerCoManagedTaskDisclosureCases } from './helpers/coManagedTaskDisclosureCases';
import { registerCoManagedRequesterTaskCases } from './helpers/coManagedRequesterTaskCases';

registerCoManagedTaskDisclosureCases();
registerCoManagedRequesterTaskCases();
