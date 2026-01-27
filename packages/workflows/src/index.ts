/**
 * @alga-psa/workflows
 *
 * Workflow automation module for Alga PSA.
 * Main entry point exports buildable lib/models/config/forms code only.
 *
 * For runtime code (Next.js transpiled), use:
 * - '@alga-psa/workflows/actions' for server actions
 * - '@alga-psa/workflows/components' for React components
 * - '@alga-psa/workflows/visualization/hooks' for visualization hooks
 */

// NOTE: Models are NOT exported from main entry because they import @alga-psa/db
// which has server-only dependencies (fs, knex, async_hooks).
// Import models directly: '@alga-psa/workflows/models'

// Config (buildable)
export { workflowConfig } from './config/workflowConfig';

// Lib utilities (buildable)
export * from './lib/workflowValidation';
export * from './lib/templateUtils';
export * from './lib/templateVariables';

// Forms (buildable - pure logic, no React dependencies)
export * from './forms/actionHandlerRegistry';
export * from './forms/conditionalLogic';

// Visualization AST types (buildable - pure TypeScript types)
export * from './visualization/types/astTypes';

// Visualization AST utilities (buildable)
export * from './visualization/ast';

// NOTE: workflow-runtime-v2-schemas is NOT exported from main entry
// because it imports @shared/workflow/runtime which has server-only dependencies.
// Import it directly: '@alga-psa/workflows/actions/workflow-runtime-v2-schemas'
