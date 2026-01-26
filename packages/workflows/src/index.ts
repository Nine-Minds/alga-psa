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

// Models (buildable)
export * from './models';

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

// Schemas (buildable - pure Zod schemas)
export * from './actions/workflow-runtime-v2-schemas';
