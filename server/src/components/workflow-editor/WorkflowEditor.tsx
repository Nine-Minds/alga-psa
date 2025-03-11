"use client";

import React, { useEffect, useRef, useState } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import { Card } from "server/src/components/ui/Card";
import { Button } from "server/src/components/ui/Button";
import { ReflectionContainer } from "server/src/types/ui-reflection/ReflectionContainer";
import { Save, Play, Code2, AlertTriangle } from "lucide-react";

// TypeScript type definitions for workflow context
const workflowTypeDefinitions = `
interface WorkflowDataManager {
  get<T>(key: string): T;
  set<T>(key: string, value: T): void;
}

interface WorkflowEventManager {
  waitFor(eventName: string | string[]): Promise<WorkflowEvent>;
  emit(eventName: string, payload?: any): Promise<void>;
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

function defineWorkflow(
  nameOrMetadata: string | WorkflowMetadata,
  executeFn: (context: WorkflowContext) => Promise<void>
): any {
  // Implementation details hidden
  return { metadata: {}, execute: () => {} };
}
`;

// Default workflow template
const defaultWorkflowTemplate = `import { defineWorkflow } from '@shared/workflow/core/workflowDefinition';
import { WorkflowContext } from '@shared/workflow/core/workflowContext';

/**
 * Example workflow definition
 */
export const myWorkflow = defineWorkflow(
  {
    name: 'MyWorkflow',
    description: 'Description of my workflow',
    version: '1.0.0',
    tags: ['example', 'template']
  },
  async (context: WorkflowContext) => {
    const { actions, data, events, logger } = context;
    
    // Initial state
    context.setState('initial');
    logger.info('Workflow started');
    
    // Store some data
    data.set('startTime', new Date().toISOString());
    
    // Wait for an event
    const triggerEvent = await events.waitFor('TriggerAction');
    logger.info('Received trigger event', triggerEvent.payload);
    
    // Update state
    context.setState('processing');
    
    // Execute an action
    try {
      const result = await actions.example_action({
        param1: triggerEvent.payload.value,
        param2: 'some value'
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
);
`;

// Code snippets for common workflow patterns
const workflowSnippets = [
  {
    label: "Basic Workflow Structure",
    insertText: `export const myWorkflow = defineWorkflow(
  {
    name: 'MyWorkflow',
    description: 'Description of my workflow',
    version: '1.0.0',
    tags: ['example']
  },
  async (context: WorkflowContext) => {
    const { actions, data, events, logger } = context;
    
    // Initial state
    context.setState('initial');
    
    // Workflow implementation
    $0
    
    // Final state
    context.setState('completed');
  }
);`
  },
  {
    label: "Wait for Event",
    insertText: `// Wait for a specific event
const event = await events.waitFor('EventName');
logger.info('Received event', event.payload);

// Wait for one of multiple events
const event = await events.waitFor(['Event1', 'Event2', 'Event3']);
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
    insertText: `try {
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
  initialValue?: string;
  onSave?: (value: string) => Promise<void>;
  onTest?: (value: string) => Promise<void>;
  readOnly?: boolean;
  height?: string;
}

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  initialValue = defaultWorkflowTemplate,
  onSave,
  onTest,
  readOnly = false,
  height = "70vh"
}) => {
  const [editorValue, setEditorValue] = useState<string>(initialValue || defaultWorkflowTemplate);
  const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Handle editor initialization
  const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);

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

        export function defineWorkflow(
          nameOrMetadata: string | WorkflowMetadata,
          executeFn: (context: import('@shared/workflow/core/workflowContext').WorkflowContext) => Promise<void>
        ): WorkflowDefinition;
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
          actions: Record<string, any>;
          data: WorkflowDataManager;
          events: WorkflowEventManager;
          logger: WorkflowLogger;
          getCurrentState(): string;
          setState(state: string): void;
        }

        export type WorkflowFunction = (context: WorkflowContext) => Promise<void>;
      }`,
      "shared-workflow-context.d.ts"
    );

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

    // Register code snippets
    monaco.languages.registerCompletionItemProvider("typescript", {
      provideCompletionItems: (model, position) => {
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
  };

  // Handle editor value change
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditorValue(value);
    }
  };

  // Update editorValue when initialValue changes
  useEffect(() => {
    if (initialValue) {
      setEditorValue(initialValue);
    }
  }, [initialValue]);
  
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
    if (onTest && editorValue) {
      await onTest(editorValue);
    }
  };

  return (
    <ReflectionContainer id="workflow-editor-container" label="Workflow Editor">
      <Card className="p-4">
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
                <Button
                  id="save-workflow-button"
                  onClick={handleSave}
                  disabled={!isEditorReady}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="border rounded-md overflow-hidden" style={{ height }}>
          <Editor
            height="100%"
            defaultLanguage="typescript"
            value={editorValue}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
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
              }
            }}
          />
        </div>
      </Card>
    </ReflectionContainer>
  );
};

export default WorkflowEditor;