import * as ts from 'typescript';

/**
 * Options for parsing a workflow definition
 */
export interface ParseOptions {
  sourceFile: string;
  sourceText?: string;
  compilerOptions?: ts.CompilerOptions;
}

/**
 * Parse a TypeScript workflow definition file into an AST
 * 
 * @param options Parse options
 * @returns The parsed source file
 */
export function parseWorkflowDefinition(options: ParseOptions): ts.SourceFile {
  const { sourceFile, sourceText, compilerOptions = {} } = options;
  
  // Default compiler options needed for TypeScript to work properly
  const defaultCompilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    allowJs: true,
    skipLibCheck: true,
    lib: ["es2020", "dom"],
    noEmit: true
  };
  
  // Merge default options with provided options
  const mergedOptions = { ...defaultCompilerOptions, ...compilerOptions };
  
  // Create a program to parse the source file
  let program: ts.Program;
  
  if (sourceText) {
    // Create a source file directly without using createCompilerHost
    const sourceFile = ts.createSourceFile(
      options.sourceFile,
      sourceText,
      mergedOptions.target || ts.ScriptTarget.ES2020,
      true
    );
    
    // Create a minimal compiler host
    const host: ts.CompilerHost = {
      getSourceFile: (fileName) => fileName === options.sourceFile ? sourceFile : undefined,
      getDefaultLibFileName: () => "lib.d.ts",
      writeFile: () => {},
      getCurrentDirectory: () => "",
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => false,
      getNewLine: () => "\n",
      fileExists: (fileName) => fileName === options.sourceFile,
      readFile: () => "",
      directoryExists: () => true,
      getDirectories: () => []
    };
    
    program = ts.createProgram([options.sourceFile], mergedOptions, host);
  } else {
    // Create a program from the file system
    program = ts.createProgram([sourceFile], mergedOptions);
  }
  
  // Get the source file from the program
  const source = program.getSourceFile(sourceFile);
  if (!source) {
    throw new Error(`Could not find source file: ${sourceFile}`);
  }
  
  return source;
}

/**
 * Find the workflow execute function in a source file
 *
 * @param sourceFile The parsed source file
 * @returns The workflow execute function or undefined if not found
 */
export function findWorkflowExecuteFunction(sourceFile: ts.SourceFile): ts.FunctionLike | undefined {
  let executeFunction: ts.FunctionLike | undefined;
  
  // Visit each node to find the workflow execute function
  function visit(node: ts.Node) {
    // Look for async functions that take a context parameter
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      
      // Check if it has a parameter named 'context'
      const parameters = node.parameters;
      if (parameters.length > 0 &&
          ts.isIdentifier(parameters[0].name) &&
          parameters[0].name.text === 'context') {
        
        // This is likely a workflow function
        executeFunction = node;
        return;
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return executeFunction;
}

/**
 * Get source location information for a node
 *
 * @param node The TypeScript node
 * @returns Source location information
 */
export function getSourceLocation(node: ts.Node): { line: number; character: number; text: string } {
  let nodeText = '';
  try {
    nodeText = node.getText();
  } catch (error) {
    nodeText = '[Unable to get text]';
  }
  
  const sourceFile = node.getSourceFile();
  
  if (!sourceFile) {
    // Return default values if source file is not available
    return {
      line: 0,
      character: 0,
      text: nodeText
    };
  }
  
  try {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    
    return {
      line: line + 1, // Convert to 1-based line number
      character: character + 1, // Convert to 1-based character position
      text: nodeText
    };
  } catch (error) {
    // Return default values if there's an error getting position
    return {
      line: 0,
      character: 0,
      text: nodeText
    };
  }
}

/**
 * Check if a node is a property access expression with the given object and property
 * 
 * @param node The TypeScript node
 * @param objectName The name of the object
 * @param propertyName The name of the property
 * @returns True if the node is a property access expression with the given object and property
 */
export function isPropertyAccessWithNames(
  node: ts.Node,
  objectName: string,
  propertyName: string
): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  
  const obj = node.expression;
  const prop = node.name;
  
  return (ts.isIdentifier(obj) && obj.text === objectName &&
          ts.isIdentifier(prop) && prop.text === propertyName);
}

/**
 * Check if a node is a call to a method on an object
 * 
 * @param node The TypeScript node
 * @param objectName The name of the object
 * @param methodName The name of the method
 * @returns True if the node is a call to the specified method
 */
export function isMethodCall(
  node: ts.Node,
  objectName: string,
  methodName: string
): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  
  const obj = expression.expression;
  const method = expression.name;
  
  return (ts.isIdentifier(obj) && obj.text === objectName &&
          ts.isIdentifier(method) && method.text === methodName);
}

/**
 * Safely get text from a TypeScript node
 *
 * @param node The TypeScript node
 * @returns The text of the node or a placeholder if it can't be retrieved
 */
function safeGetText(node: ts.Node): string {
  try {
    return node.getText();
  } catch (error) {
    return '[Expression]';
  }
}

/**
 * Extract argument values from a call expression
 *
 * @param node The call expression node
 * @returns Array of argument values (as best as can be determined statically)
 */
export function extractArgumentValues(node: ts.CallExpression): any[] {
  return node.arguments.map(arg => {
    if (ts.isStringLiteral(arg)) {
      return arg.text;
    } else if (ts.isNumericLiteral(arg)) {
      return parseFloat(arg.text);
    } else if (ts.isArrayLiteralExpression(arg)) {
      return arg.elements.map(element => {
        if (ts.isStringLiteral(element)) {
          return element.text;
        } else if (ts.isNumericLiteral(element)) {
          return parseFloat(element.text);
        } else {
          return `[${safeGetText(element)}]`; // Return text representation for complex expressions
        }
      });
    } else if (ts.isObjectLiteralExpression(arg)) {
      const obj: Record<string, any> = {};
      arg.properties.forEach(prop => {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const propName = prop.name.text;
          const propValue = prop.initializer;
          
          if (ts.isStringLiteral(propValue)) {
            obj[propName] = propValue.text;
          } else if (ts.isNumericLiteral(propValue)) {
            obj[propName] = parseFloat(propValue.text);
          } else {
            obj[propName] = `[${safeGetText(propValue)}]`; // Return text representation for complex expressions
          }
        }
      });
      return obj;
    } else {
      return `[${safeGetText(arg)}]`; // Return text representation for complex expressions
    }
  });
}