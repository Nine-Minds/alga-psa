"use client";

import React, { useEffect, useRef, useState, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor, Uri } from "monaco-editor";
import { Card } from "@server/components/ui/Card";
import { Button } from "@server/components/ui/Button";
import { ReflectionContainer } from "@server/types/ui-reflection/ReflectionContainer";
import { Play, Code2, AlertTriangle } from "lucide-react";
import { getRegisteredWorkflowActions } from "@server/lib/actions/workflow-actions/workflowActionRegistry";
import { ActionParameterDefinition } from "@alga-psa/shared/workflow/core";
import EditorSkeleton from "@server/components/ui/skeletons/EditorSkeleton";

// Dynamic import for Monaco Editor
const DynamicMonacoEditor = dynamic(() => import('./DynamicMonacoEditor'), {
  loading: () => <EditorSkeleton height="100%" showHeader={false} showButtons={false} />,
  ssr: false
});

// Serializable version of action definition
interface SerializableActionDefinition {
  name: string;
  description: string;
  parameters: ActionParameterDefinition[];
}

// TypeScript type definitions for workflow context
const workflowTypeDefinitions = `
interface WorkflowDataManager {
  get<T>(key: string): T;
  set<T>(key: string, value: T): void;
}

interface WorkflowEventManager {
  emit(eventName: string, payload?: any): Promise<void>;
}

interface WorkflowInput {
  triggerEvent: WorkflowEvent;
  parameters?: Record<string, any>;
}

interface WorkflowEvent {
  name: string;
  payload: any;
  user_id?: string;
  timestamp: string;
  processed?: boolean;
}

interface WorkflowLogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

interface WorkflowContext {
  executionId: string;
  tenant: string;
  actions: Record<string, any>;
  data: WorkflowDataManager;
  events: WorkflowEventManager;
  logger: WorkflowLogger;
  input: WorkflowInput;
  getCurrentState(): string;
  setState(state: string): void;
}

interface WorkflowMetadata {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
}
`;

// Default workflow template
const defaultWorkflowTemplate = `/**
 * Example workflow function
 *
 * @param context The workflow context provided by the runtime
 */
async function workflow(context: WorkflowContext): Promise<void> {
  // Use type assertion for better autocompletion with actions
  const actions = context.actions as WorkflowActions;
  const { data, events, logger } = context;
  
  // Initial state
  context.setState('initial');
  logger.info('Workflow started');
  
  // Store some data
  data.set('startTime', new Date().toISOString());
  
  // Get input data from the trigger event
  const triggerEvent = context.input.triggerEvent;
  logger.info('Processing trigger event', triggerEvent.payload);
  
  // Update state
  context.setState('processing');
  
  // Execute an action
  try {
    const result = await actions.log_audit_message({
      message: "Hello World!"
    });
    
    logger.info('Action completed successfully', result);
    data.set('result', result);
    
    // Emit an event
    await events.emit('ActionCompleted', { success: true, result });
    
    // Final state
    context.setState('completed');
  } catch (error) {
    logger.error('Action failed', error);
    context.setState('failed');
  }
}
`;

// Code snippets for common workflow patterns
const workflowSnippets = [
  {
    label: "Basic Workflow Structure",
    insertText: `/**
 * Workflow function
 *
 * @param context The workflow context provided by the runtime
 */
async function workflow(context: WorkflowContext): Promise<void> {
  // Use type assertion for better autocompletion with actions
  const actions = context.actions as WorkflowActions;
  const { data, events, logger } = context;
  
  // Initial state
  context.setState('initial');
  
  // Workflow implementation
  $0
  
  // Final state
  context.setState('completed');
}`
  },
  {
    label: "Process Trigger Event",
    insertText: `// Get the trigger event from the context
const event = context.input.triggerEvent;
logger.info('Processing event', event.payload);

// Handle different event types based on event name
if (event.name === 'Event1') {
  // Handle Event1
} else if (event.name === 'Event2') {
  // Handle Event2
} else {
  // Handle Event3
}
$0`
  },
  {
    label: "Execute Action",
    insertText: `// Note: Make sure actions is properly typed with 'as WorkflowActions' when destructuring
try {
  const result = await actions.action_name({
    param1: 'value1',
    param2: 'value2'
  });
  
  logger.info('Action completed successfully', result);
  data.set('result', result);
} catch (error) {
  logger.error('Action failed', error);
  context.setState('failed');
}
$0`
  },
  {
    label: "Parallel Actions",
    insertText: `// Execute multiple actions in parallel
const [result1, result2] = await Promise.all([
  actions.action1({ param: 'value1' }),
  actions.action2({ param: 'value2' })
]);

logger.info('All actions completed');
$0`
  },
  {
    label: "Conditional Logic",
    insertText: `// Get data from context
const value = data.get<number>('someValue');

// Conditional execution based on data
if (value > 100) {
  await actions.high_value_action({ value });
  context.setState('high_value');
} else if (value > 50) {
  await actions.medium_value_action({ value });
  context.setState('medium_value');
} else {
  await actions.low_value_action({ value });
  context.setState('low_value');
}
$0`
  },
  {
    label: "Error Handling",
    insertText: `try {
  // Risky operation
  const result = await actions.risky_action();
  context.setState('success');
} catch (error) {
  // Log the error
  logger.error('Operation failed', error);
  
  // Store error information
  data.set('error', {
    message: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString()
  });
  
  // Emit error event
  await events.emit('ErrorOccurred', { 
    error: error instanceof Error ? error.message : String(error)
  });
  
  // Set error state
  context.setState('error');
}
$0`
  }
];

interface ValidationWarning {
  message: string;
  type: 'warning' | 'error';
}

interface WorkflowEditorProps {
  initialValue: string | null;
  isNewWorkflow: boolean;
  onSave?: (value: string) => Promise<void>;
  onTest?: (value: string) => Promise<void>;
  readOnly?: boolean;
  height?: string;
  workflowId?: string;
}

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  initialValue,
  isNewWorkflow,
  onSave,
  onTest,
  readOnly = false,
  height = "70vh",
  workflowId
}) => {
  // Store the current model URI
  const modelUri = useRef<Uri | null>(null);
  
  // Editor state
  const [editorValue, setEditorValue] = useState<string>("");
  const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
  const [isEditorInitialized, setIsEditorInitialized] = useState<boolean>(false);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  
  // Refs
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Function to generate TypeScript definitions for actions
  const generateActionTypeDefinitions = (actions: Record<string, SerializableActionDefinition>): string => {
    let typeDefs = `
interface WorkflowActions {
`;

    // Add method signatures for each action
    for (const [actionName, action] of Object.entries(actions)) {
      // Convert camelCase to snake_case for the method name
      const snakeCaseName = actionName.replace(/([A-Z])/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, '');
      
      // Generate parameter interface
      typeDefs += `  /**
   * ${action.description}
   */\n`;
      
      // Add both camelCase and snake_case versions of the method
      typeDefs += `  ${actionName}(params: {
${action.parameters.map((param: ActionParameterDefinition) => `    ${param.name}${param.required ? '' : '?'}: ${param.type};`).join('\n')}
  }): Promise<any>;\n\n`;
      
      // Only add snake_case version if it's different from camelCase
      if (snakeCaseName !== actionName) {
        typeDefs += `  /**
   * ${action.description}
   */\n`;
        typeDefs += `  ${snakeCaseName}(params: {
${action.parameters.map((param: ActionParameterDefinition) => `    ${param.name}${param.required ? '' : '?'}: ${param.type};`).join('\n')}
  }): Promise<any>;\n\n`;
      }
    }

    typeDefs += `}`;
    return typeDefs;
  };

  // Function to setup TypeScript definitions
  const setupTypeScriptDefinitions = async (monaco: Monaco) => {
    // Add TypeScript definitions
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      workflowTypeDefinitions,
      "workflow-types.d.ts"
    );

    // Add shared module type definitions
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `declare module '@shared/workflow/core/workflowDefinition' {
        export interface WorkflowMetadata {
          name: string;
          description?: string;
          version?: string;
          author?: string;
          tags?: string[];
        }

        export interface WorkflowDefinition {
          metadata: WorkflowMetadata;
          execute: (context: import('@shared/workflow/core/workflowContext').WorkflowContext) => Promise<void>;
        }
      }`,
      "shared-workflow-definition.d.ts"
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `declare module '@shared/workflow/core/workflowContext' {
        export interface WorkflowDataManager {
          get<T>(key: string): T;
          set<T>(key: string, value: T): void;
        }

        export interface WorkflowEventManager {
          emit(eventName: string, payload?: any): Promise<void>;
        }
        
        export interface WorkflowInput {
          triggerEvent: WorkflowEvent;
          parameters?: Record<string, any>;
        }

        export interface WorkflowEvent {
          name: string;
          payload: any;
          user_id?: string;
          timestamp: string;
          processed?: boolean;
        }

        export interface WorkflowLogger {
          info(message: string, ...args: any[]): void;
          warn(message: string, ...args: any[]): void;
          error(message: string, ...args: any[]): void;
          debug(message: string, ...args: any[]): void;
        }

        export interface WorkflowContext {
          executionId: string;
          tenant: string;
          actions: Record<string, any>;
          data: WorkflowDataManager;
          events: WorkflowEventManager;
          logger: WorkflowLogger;
          input: WorkflowInput;
          getCurrentState(): string;
          setState(state: string): void;
        }

        export type WorkflowFunction = (context: WorkflowContext) => Promise<void>;
      }`,
      "shared-workflow-context.d.ts"
    );

    try {
      // Fetch registered actions using server action
      const registeredActions = await getRegisteredWorkflowActions();
      
      // Generate action type definitions
      const actionTypeDefinitions = generateActionTypeDefinitions(registeredActions);
      
      // Add action type definitions to the editor
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        `declare module '@shared/workflow/core/actionTypes' {
          ${actionTypeDefinitions}
        }`,
        "workflow-action-types.d.ts"
      );
      
      // Add the WorkflowActions interface to the global scope with proper declaration
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        actionTypeDefinitions,
        "workflow-actions-global.d.ts"
      );
      
      // Update the WorkflowContext interface to use the WorkflowActions type
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        `declare module '@shared/workflow/core/workflowContext' {
          import { WorkflowActions } from '@shared/workflow/core/actionTypes';
          
          export interface WorkflowDataManager {
            get<T>(key: string): T;
            set<T>(key: string, value: T): void;
          }
          
          export interface WorkflowEventManager {
            waitFor(eventName: string | string[]): Promise<WorkflowEvent>;
            emit(eventName: string, payload?: any): Promise<void>;
          }
          
          export interface WorkflowEvent {
            name: string;
            payload: any;
            user_id?: string;
            timestamp: string;
            processed?: boolean;
          }
          
          export interface WorkflowLogger {
            info(message: string, ...args: any[]): void;
            warn(message: string, ...args: any[]): void;
            error(message: string, ...args: any[]): void;
            debug(message: string, ...args: any[]): void;
          }
          
          export interface WorkflowContext {
            executionId: string;
            tenant: string;
            actions: WorkflowActions;
            data: WorkflowDataManager;
            events: WorkflowEventManager;
            logger: WorkflowLogger;
            input: WorkflowInput;
            getCurrentState(): string;
            setState(state: string): void;
          }
          
          export type WorkflowFunction = (context: WorkflowContext) => Promise<void>;
        }`,
        "shared-workflow-context-with-actions.d.ts"
      );
    } catch (error) {
      console.error('Error fetching workflow actions:', error);
    }

    // Configure TypeScript compiler options
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
      lib: ["dom", "es2015", "es2016", "es2017", "es2018", "es2019", "es2020"]
    });
  };

  // Create a TypeScript model
  const createTypeScriptModel = (monaco: Monaco, content: string): MonacoEditor.ITextModel => {
    // Create a URI with a .ts extension
    const uri = monaco.Uri.parse("file:///workflow.ts");
    modelUri.current = uri;
    
    // Create a new model with TypeScript content
    return monaco.editor.createModel(content, "typescript", uri);
  };

  // Handle editor initialization
  const handleEditorDidMount = async (editorInstance: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    console.log('Editor mounted, waiting for content before initialization');
    
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    
    try {
      // First fetch registered actions and setup TypeScript definitions
      console.log('Setting up TypeScript definitions with action types...');
      
      // Setup TypeScript definitions - this now includes fetching registered actions first
      await setupTypeScriptDefinitions(monaco);
      
      // Register code snippets
      monaco.languages.registerCompletionItemProvider("typescript", {
        provideCompletionItems: (model: MonacoEditor.ITextModel, position: any) => {
          const suggestions = workflowSnippets.map((snippet) => {
            return {
              label: snippet.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              documentation: snippet.label,
              insertText: snippet.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: position.column,
                endColumn: position.column
              }
            };
          });
  
          return { suggestions };
        }
      });
      
      console.log('Editor setup complete with proper action types');
      setIsEditorReady(true);
    } catch (error) {
      console.error('Error setting up workflow editor:', error);
      setEditorError('Failed to load workflow action types. Please refresh and try again.');
    }
  };

  // Reference to store the timeout ID for debouncing
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced function to notify parent of content changes
  const debouncedNotifyParent = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      if (onSave && value !== initialValue) {
        console.log("Editor content updated, notifying parent component (debounced)");
        onSave(value);
      }
    }, 500); // 500ms debounce delay
  }, [onSave, initialValue]);

  // Handle editor value change
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditorValue(value);
      
      // Use debounced version to avoid excessive updates
      debouncedNotifyParent(value);
    }
  };

  // Initialize the editor with content once we have it
  useEffect(() => {
    // Only initialize once
    if (isEditorInitialized) {
      return;
    }
    
    // Wait until editor is ready and we have content information
    if (!isEditorReady || !monacoRef.current || !editorRef.current || initialValue === undefined) {
      return;
    }
    
    console.log('Initializing editor with content', {
      initialValue,
      isNewWorkflow,
      workflowId
    });
    
    // Handle different scenarios
    if (initialValue === null && workflowId) {
      // We have a workflow ID but no content - show error
      setEditorError(`Error: Could not load workflow content for ID: ${workflowId}`);
      return;
    }
    
    // Determine what content to use
    let contentToUse: string;
    if (initialValue !== null) {
      // We have content from the server
      contentToUse = initialValue;
      console.log('Using server content for editor');
    } else if (isNewWorkflow) {
      // This is a new workflow, use the default template
      contentToUse = defaultWorkflowTemplate;
      console.log('Using default template for new workflow');
    } else {
      // Fallback case - should not happen with proper props
      contentToUse = defaultWorkflowTemplate;
      console.log('WARNING: Falling back to default template');
    }
    
    // Create a TypeScript model with the content
    const model = createTypeScriptModel(monacoRef.current, contentToUse);
    
    // Set the model to the editor
    editorRef.current.setModel(model);
    
    // Set the editor value
    setEditorValue(contentToUse);
    
    // Mark as initialized
    setIsEditorInitialized(true);
    
  }, [isEditorReady, initialValue, isNewWorkflow, workflowId, isEditorInitialized]);
  
  // Validate code and show warnings
  const validateCode = (code: string) => {
    // This is a simple validation for demonstration
    // In a real implementation, we would use the TypeScript compiler API
    const warnings: ValidationWarning[] = [];
    
    // Check for common issues
    if (!code.includes('context.setState')) {
      warnings.push({
        message: "Workflow doesn't use context.setState to track workflow state",
        type: 'warning'
      });
    }
    
    if (!code.includes('try') || !code.includes('catch')) {
      warnings.push({
        message: "Workflow doesn't include error handling (try/catch blocks)",
        type: 'warning'
      });
    }
    
    if (!code.includes('await')) {
      warnings.push({
        message: "Workflow doesn't use await for asynchronous operations",
        type: 'warning'
      });
    }
    
    setValidationWarnings(warnings);
  };
  
  // Validate code when it changes
  useEffect(() => {
    if (editorValue) {
      validateCode(editorValue);
    }
  }, [editorValue]);

  // Handle save button click
  const handleSave = async () => {
    if (onSave && editorValue) {
      await onSave(editorValue);
    }
  };

  // Handle test button click
  const handleTest = async () => {
    if (editorValue) {
      // Make sure to update the parent with the latest code before testing
      if (onSave) {
        await onSave(editorValue);
      }
      
      // Then run the test
      if (onTest) {
        await onTest(editorValue);
      }
    }
  };

  return (
    <ReflectionContainer id="workflow-editor-container" label="Workflow Editor">
      <Card className="p-4">
        {editorError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center mb-2">
              <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
              <h3 className="text-sm font-medium text-red-700">Error</h3>
            </div>
            <p className="text-sm text-red-600">{editorError}</p>
          </div>
        )}
        
        {validationWarnings.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-center mb-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
              <h3 className="text-sm font-medium text-yellow-700">Workflow Validation Warnings</h3>
            </div>
            <ul className="text-sm text-yellow-600 space-y-1 ml-7 list-disc">
              {validationWarnings.map((warning, index) => (
                <li key={index}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center">
            <Code2 className="h-5 w-5 text-primary-500 mr-2" />
            <h2 className="text-lg font-semibold">TypeScript Workflow Editor</h2>
          </div>
          <div className="flex space-x-2">
            {!readOnly && (
              <>
                <Button
                  id="test-workflow-button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={!isEditorReady}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Test
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="border rounded-md overflow-hidden" style={{ height }}>
          <Suspense fallback={<EditorSkeleton height="100%" showHeader={false} showButtons={false} />}>
            <DynamicMonacoEditor
              height="100%"
              language="typescript"
              value={isEditorInitialized ? editorValue : ""}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              loading={<div className="flex items-center justify-center h-full">Loading editor...</div>}
              options={{
                readOnly,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                formatOnPaste: true,
                formatOnType: true,
                tabSize: 2,
                wordWrap: "on",
                wrappingIndent: "indent",
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 12,
                  horizontalScrollbarSize: 12
                },
                theme: "vs-dark"
              }}
              beforeMount={(monaco) => {
                // Configure Monaco to treat all files as TypeScript
                monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                  noSemanticValidation: false,
                  noSyntaxValidation: false
                });
              }}
            />
          </Suspense>
        </div>
      </Card>
    </ReflectionContainer>
  );
};

export default WorkflowEditor;
