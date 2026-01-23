/**
 * Monaco Signature Help Provider for JSONata Workflow Expressions
 *
 * Shows function parameter hints when typing inside function parentheses.
 * Highlights the current parameter as the user types.
 */

import type * as monaco from 'monaco-editor';
import { builtinFunctions, type FunctionDefinition } from './functionDefinitions';
import { LANGUAGE_ID } from './jsonataLanguage';

/**
 * Find the function call context at the cursor position
 */
function findFunctionContext(
  text: string,
  cursorOffset: number
): { functionName: string; parameterIndex: number } | null {
  // Walk backwards from cursor to find the function call
  let depth = 0;
  let commaCount = 0;
  let i = cursorOffset - 1;

  while (i >= 0) {
    const char = text[i];

    if (char === ')') {
      depth++;
    } else if (char === '(') {
      if (depth === 0) {
        // Found the opening parenthesis, now find the function name
        let nameEnd = i;
        let nameStart = i - 1;

        // Skip whitespace
        while (nameStart >= 0 && /\s/.test(text[nameStart])) {
          nameStart--;
        }

        nameEnd = nameStart + 1;

        // Find the function name (starts with $)
        while (nameStart >= 0 && /[a-zA-Z0-9_$]/.test(text[nameStart])) {
          nameStart--;
        }
        nameStart++;

        const functionName = text.slice(nameStart, nameEnd);

        if (functionName.startsWith('$')) {
          return {
            functionName,
            parameterIndex: commaCount,
          };
        }

        return null;
      }
      depth--;
    } else if (char === ',' && depth === 0) {
      commaCount++;
    }

    i--;
  }

  return null;
}

/**
 * Create signature information for a function
 */
function createSignatureInfo(
  fn: FunctionDefinition,
  monacoInstance: typeof monaco
): monaco.languages.SignatureInformation {
  // Build the signature label
  const paramLabels: [number, number][] = [];
  let labelOffset = fn.name.length + 1; // After function name and (

  const paramStrings = fn.parameters.map((p, idx) => {
    const paramStr = p.optional ? `${p.name}?` : p.name;
    const start = labelOffset;
    const end = labelOffset + paramStr.length;
    paramLabels.push([start, end]);
    labelOffset = end + 2; // Account for ", "
    return paramStr;
  });

  const signatureLabel = `${fn.name}(${paramStrings.join(', ')})`;

  // Create parameter information
  const parameters: monaco.languages.ParameterInformation[] = fn.parameters.map((p, idx) => ({
    label: paramLabels[idx],
    documentation: {
      value: `**${p.name}**: \`${p.type}\`${p.optional ? ' *(optional)*' : ''}\n\n${p.description}`,
    },
  }));

  return {
    label: signatureLabel,
    documentation: {
      value: fn.description + (fn.returnType ? `\n\n**Returns:** \`${fn.returnType}\`` : ''),
    },
    parameters,
  };
}

/**
 * Create the signature help provider
 */
export function createSignatureHelpProvider(
  monacoInstance: typeof monaco
): monaco.languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],

    provideSignatureHelp: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      _token: monaco.CancellationToken,
      _context: monaco.languages.SignatureHelpContext
    ): monaco.languages.ProviderResult<monaco.languages.SignatureHelpResult> => {
      const text = model.getValue();
      const offset = model.getOffsetAt(position);

      const funcContext = findFunctionContext(text, offset);
      if (!funcContext) return null;

      // Find the function definition
      const fn = builtinFunctions.find(f => f.name === funcContext.functionName);
      if (!fn) return null;

      const signatureInfo = createSignatureInfo(fn, monacoInstance);

      return {
        value: {
          signatures: [signatureInfo],
          activeSignature: 0,
          activeParameter: Math.min(funcContext.parameterIndex, fn.parameters.length - 1),
        },
        dispose: () => {},
      };
    },
  };
}

/**
 * Register the signature help provider with Monaco
 */
export function registerSignatureHelpProvider(
  monacoInstance: typeof monaco
): monaco.IDisposable {
  return monacoInstance.languages.registerSignatureHelpProvider(
    LANGUAGE_ID,
    createSignatureHelpProvider(monacoInstance)
  );
}
