/**
 * Expression Editor Module
 *
 * Monaco-based editor for JSONata workflow expressions
 */

// Main components
export { ExpressionEditor, type ExpressionEditorProps, type ExpressionEditorHandle } from './ExpressionEditor';
export { ExpressionEditorField, type ExpressionEditorFieldProps, type DataContextInfo } from './ExpressionEditorField';
export type { ExpressionContext, JsonSchema } from './completionProvider';
export {
  buildWorkflowExpressionContext,
  buildTriggerMappingExpressionContext,
  DEFAULT_META_SCHEMA,
  DEFAULT_ERROR_SCHEMA,
  type WorkflowExpressionContextParams,
  type TriggerMappingExpressionContextParams,
} from './expressionContextBuilder';

// Language definition
export { LANGUAGE_ID, registerJsonataLanguage } from './jsonataLanguage';

// Themes
export { LIGHT_THEME_NAME, DARK_THEME_NAME, registerJsonataThemes } from './jsonataTheme';

// Functions
export { builtinFunctions, findFunction, getFunctionsByCategory, type FunctionDefinition, type FunctionParameter } from './functionDefinitions';

// Completion provider
export { createCompletionProvider, registerCompletionProvider } from './completionProvider';

// Hover provider
export { createHoverProvider, registerHoverProvider } from './hoverProvider';

// Signature help provider
export { createSignatureHelpProvider, registerSignatureHelpProvider } from './signatureHelpProvider';

// Diagnostics provider
export {
  createDiagnosticsProvider,
  validateExpression,
  diagnosticsToMarkers,
  type ExpressionDiagnostic,
  DiagnosticSeverity,
} from './diagnosticsProvider';
