/**
 * Utility functions for validating workflow code
 */

import { z } from 'zod';
import logger from '@alga-psa/core/logger';
import { Project, Node, SyntaxKind, ObjectLiteralExpression, ts } from 'ts-morph';

// Zod schema for workflow metadata
export const WorkflowMetadataSchema = z.object({
  name: z.string().min(1, "Workflow name is required"),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Regex patterns for workflow validation (keeping these for other validation functions)
const patterns = {
  contextUsage: /context\.(actions|data|events|logger|setState|getCurrentState)/g,
  asyncAwait: /async[\s\S]*?await/,
  errorHandling: /try\s*{[\s\S]*?}\s*catch\s*\(/,
};

/**
 * Extract metadata from workflow code using TypeScript AST
 *
 * @param code TypeScript workflow code
 * @returns Extracted metadata or null if not found
 */
export function extractWorkflowMetadata(code: string): z.infer<typeof WorkflowMetadataSchema> | null {
  try {
    // Create a TypeScript project with the code and proper compiler options
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: 1, // CommonJS
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        noLib: true // Don't use the default lib files
      }
    });
    
    // Add minimal type definitions for global types
    project.createSourceFile(
      "lib.d.ts",
      `
      interface Array<T> {}
      interface Boolean {}
      interface Date {}
      interface Error {
        name: string;
        message: string;
        stack?: string;
      }
      interface Function {}
      interface IArguments {}
      interface Number {}
      interface Object {}
      interface Promise<T> {}
      interface RegExp {}
      interface String {}
      interface JSON {}
      
      declare var Array: any;
      declare var Boolean: any;
      declare var Date: any;
      declare var Error: any;
      declare var Function: any;
      declare var Number: any;
      declare var Object: any;
      declare var Promise: any;
      declare var RegExp: any;
      declare var String: any;
      declare var JSON: any;
      `
    );
    
    // Add type definitions for shared modules
    project.createSourceFile(
      "shared-workflow-definition.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowDefinition' {
        export interface WorkflowMetadata {
          name: string;
          description?: string;
          version?: string;
          author?: string;
          tags?: string[];
        }

        export interface WorkflowDefinition {
          metadata: WorkflowMetadata;
          execute: (context: import('@alga-psa/shared/workflow/core/workflowContext').WorkflowContext) => Promise<void>;
        }
      }`
    );

    project.createSourceFile(
      "shared-workflow-context.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowContext' {
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
      }`
    );
    
    const sourceFile = project.createSourceFile('workflow.ts', code);
    
    // Look for object literals that might contain workflow metadata
    const objectLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
    
    // Try to find an object literal that has properties matching our metadata schema
    for (const objectLiteral of objectLiterals) {
      const metadata: Record<string, any> = {};
      
      for (const property of objectLiteral.getProperties()) {
        if (Node.isPropertyAssignment(property)) {
          const name = property.getName();
          const initializer = property.getInitializer();
          
          if (!initializer) continue;
          
          // Handle different types of property values
          if (Node.isStringLiteral(initializer)) {
            metadata[name] = initializer.getLiteralText();
          } else if (Node.isArrayLiteralExpression(initializer)) {
            const elements = initializer.getElements();
            metadata[name] = elements
              .filter(Node.isStringLiteral)
              .map(el => el.getLiteralText());
          } else if (Node.isNumericLiteral(initializer)) {
            metadata[name] = Number(initializer.getText());
          } else if (initializer.getText() === 'true' || initializer.getText() === 'false') {
            metadata[name] = initializer.getText() === 'true';
          } else {
            // For complex values, try using the text representation
            metadata[name] = initializer.getText();
          }
        }
      }
      
      // Check if this object has the required metadata properties
      if (metadata.name) {
        try {
          // Validate with Zod schema
          return WorkflowMetadataSchema.parse(metadata);
        } catch (error) {
          // Not a valid metadata object, continue searching
          continue;
        }
      }
    }
    
    // If we get here, we couldn't find valid metadata
    return null;
  } catch (error) {
    logger.error("Error extracting workflow metadata using AST:", error);
    return null;
  }
}

/**
 * Validate workflow code structure using TypeScript Compiler API
 * 
 * @param code TypeScript workflow code
 * @returns Validation result with errors if any
 */
export function validateWorkflowCode(code: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check if code is empty
  if (!code || code.trim() === '') {
    errors.push("Workflow code cannot be empty");
    return { valid: false, errors, warnings };
  }
  
  try {
    // Create a TypeScript project with the code and proper compiler options
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: 1, // CommonJS
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        noLib: true // Don't use the default lib files
      }
    });
    
    // Add minimal type definitions for global types
    project.createSourceFile(
      "lib.d.ts",
      `
      interface Array<T> {}
      interface Boolean {}
      interface Date {}
      interface Error {
        name: string;
        message: string;
        stack?: string;
      }
      interface Function {}
      interface IArguments {}
      interface Number {}
      interface Object {}
      interface Promise<T> {}
      interface RegExp {}
      interface String {}
      interface JSON {}
      
      declare var Array: any;
      declare var Boolean: any;
      declare var Date: any;
      declare var Error: any;
      declare var Function: any;
      declare var Number: any;
      declare var Object: any;
      declare var Promise: any;
      declare var RegExp: any;
      declare var String: any;
      declare var JSON: any;
      `
    );
    
    // Add type definitions for shared modules
    project.createSourceFile(
      "shared-workflow-definition.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowDefinition' {
        export interface WorkflowMetadata {
          name: string;
          description?: string;
          version?: string;
          author?: string;
          tags?: string[];
        }

        export interface WorkflowDefinition {
          metadata: WorkflowMetadata;
          execute: (context: import('@alga-psa/shared/workflow/core/workflowContext').WorkflowContext) => Promise<void>;
        }
      }`
    );

    project.createSourceFile(
      "shared-workflow-context.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowContext' {
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
      }`
    );
    
    const sourceFile = project.createSourceFile('workflow.ts', code);
    // We no longer need to extract metadata from the code
    
    // Check for context usage with AST
    const contextAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .filter(prop => {
        const objectText = prop.getExpression().getText();
        const propName = prop.getName();
        return objectText === 'context' && 
               ['actions', 'data', 'events', 'logger', 'setState', 'getCurrentState'].includes(propName);
      });
    
    if (contextAccesses.length === 0) {
      warnings.push("Workflow doesn't appear to use the context object (actions, data, events, logger, setState)");
    }
    
    // Check for async/await usage
    const asyncFunctionDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
      .filter(func => func.isAsync());
    
    const asyncArrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)
      .filter(arrow => arrow.isAsync());
    
    const hasAsyncFunctions = asyncFunctionDeclarations.length > 0 || asyncArrowFunctions.length > 0;
    
    const awaitExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression);
    
    if (!hasAsyncFunctions || awaitExpressions.length === 0) {
      warnings.push("Workflow doesn't appear to use async/await for asynchronous operations");
    }
    
    // Check for error handling (try/catch)
    const tryCatchBlocks = sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement);
    
    if (tryCatchBlocks.length === 0) {
      warnings.push("Workflow doesn't appear to include error handling (try/catch blocks)");
    }
    
    // Check for setState usage
    const setStateUsages = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .filter(prop => {
        const objectText = prop.getExpression().getText();
        const propName = prop.getName();
        return objectText === 'context' && propName === 'setState';
      });
    
    if (setStateUsages.length === 0) {
      warnings.push("Workflow doesn't appear to use context.setState to track workflow state");
    }
    
    // Check for TypeScript syntax and semantic errors
    const diagnostics = sourceFile.getPreEmitDiagnostics();
    
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
        const message = diagnostic.getMessageText();
        const formattedMessage = typeof message === 'string'
          ? message
          : message.getMessageText();
        
        // Skip errors related to WorkflowActions type and other common issues
        // that are handled by the editor but not by the validator
        const messageStr = String(formattedMessage);
        if (messageStr.includes("Cannot find name 'WorkflowActions'") ||
            messageStr.includes("Cannot find name 'WorkflowContext'") ||
            messageStr.includes("Modifiers cannot appear here") ||
            messageStr.includes("An export declaration can only be used at the top level") ||
            (messageStr.includes("Cannot find name") && messageStr.includes("WorkflowActions"))) {
          continue;
        }
        
        errors.push(`TypeScript error: ${formattedMessage}`);
      }
    }
    
  } catch (error) {
    errors.push(`Error analyzing workflow code: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Check if workflow code contains potentially unsafe operations using TypeScript AST
 * 
 * @param code TypeScript workflow code
 * @returns Array of security warnings
 */
export function checkWorkflowSecurity(code: string): string[] {
  const warnings: string[] = [];
  
  try {
    // Create a TypeScript project with the code and proper compiler options
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: 1, // CommonJS
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        noLib: true // Don't use the default lib files
      }
    });
    
    // Add minimal type definitions for global types
    project.createSourceFile(
      "lib.d.ts",
      `
      interface Array<T> {}
      interface Boolean {}
      interface Date {}
      interface Error {
        name: string;
        message: string;
        stack?: string;
      }
      interface Function {}
      interface IArguments {}
      interface Number {}
      interface Object {}
      interface Promise<T> {}
      interface RegExp {}
      interface String {}
      interface JSON {}
      
      declare var Array: any;
      declare var Boolean: any;
      declare var Date: any;
      declare var Error: any;
      declare var Function: any;
      declare var Number: any;
      declare var Object: any;
      declare var Promise: any;
      declare var RegExp: any;
      declare var String: any;
      declare var JSON: any;
      `
    );
    
    // Add type definitions for shared modules
    project.createSourceFile(
      "shared-workflow-definition.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowDefinition' {
        export interface WorkflowMetadata {
          name: string;
          description?: string;
          version?: string;
          author?: string;
          tags?: string[];
        }

        export interface WorkflowDefinition {
          metadata: WorkflowMetadata;
          execute: (context: import('@alga-psa/shared/workflow/core/workflowContext').WorkflowContext) => Promise<void>;
        }
      }`
    );

    project.createSourceFile(
      "shared-workflow-context.d.ts",
      `declare module '@alga-psa/shared/workflow/core/workflowContext' {
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
      }`
    );
    
    const sourceFile = project.createSourceFile('workflow.ts', code);
    
    // Check for potentially dangerous operations
    const securityChecks = [
      // Check for process.env access
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
          .some(prop => 
            prop.getExpression().getText() === 'process' && 
            prop.getName() === 'env'
          ),
        message: "Accessing process.env"
      },
      
      // Check for require() usage
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(call => call.getExpression().getText() === 'require'),
        message: "Using require() function"
      },
      
      // Check for dynamic import()
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(call => call.getExpression().getText() === 'import'),
        message: "Using dynamic import()"
      },
      
      // Check for eval() usage
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(call => call.getExpression().getText() === 'eval'),
        message: "Using eval() function"
      },
      
      // Check for Function constructor
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)
          .some(newExpr => newExpr.getExpression().getText() === 'Function'),
        message: "Using Function constructor"
      },
      
      // Check for file system access
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
          .some(prop => prop.getExpression().getText() === 'fs'),
        message: "Accessing file system (fs)"
      },
      
      // Check for child_process
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
          .some(id => id.getText() === 'child_process'),
        message: "Accessing child_process"
      },
      
      // Check for HTTP requests
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
          .some(prop => 
            (prop.getExpression().getText() === 'http' && prop.getName() === 'request') ||
            (prop.getExpression().getText() === 'https' && prop.getName() === 'request')
          ),
        message: "Making HTTP/HTTPS requests directly"
      },
      
      // Check for fetch API
      {
        check: () => sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(call => call.getExpression().getText() === 'fetch'),
        message: "Making fetch requests directly"
      },
      
      // Check for browser APIs
      {
        check: () => {
          const browserAPIs = ['XMLHttpRequest', 'document', 'window', 'localStorage', 
                               'sessionStorage', 'indexedDB', 'navigator'];
          
          return sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
            .some(id => browserAPIs.includes(id.getText()));
        },
        message: "Accessing browser APIs"
      }
    ];
    
    // Run all security checks
    for (const { check, message } of securityChecks) {
      if (check()) {
        warnings.push(`Security warning: ${message} detected in workflow code`);
      }
    }
    
    // Check for unsafe string concatenation in SQL or similar contexts
    const templateExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression);
    for (const template of templateExpressions) {
      const text = template.getText().toLowerCase();
      if (text.includes('select') && text.includes('from') || 
          text.includes('insert into') || 
          text.includes('update') || 
          text.includes('delete from')) {
        warnings.push("Security warning: Potential SQL injection risk detected - template literals used with SQL statements");
      }
    }
  } catch (error) {
    warnings.push(`Error performing security check: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return warnings;
}
