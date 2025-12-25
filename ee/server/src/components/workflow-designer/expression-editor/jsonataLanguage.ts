/**
 * JSONata-style Expression Language for Monaco Editor
 *
 * Defines the language syntax, tokenization rules, and configuration
 * for workflow expressions.
 */

import type * as monaco from 'monaco-editor';

export const LANGUAGE_ID = 'jsonata-workflow';

/**
 * Language configuration for brackets, comments, auto-closing pairs
 */
export const languageConfiguration: monaco.languages.LanguageConfiguration = {
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] },
    { open: '`', close: '`', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '`', close: '`' },
  ],
  comments: {
    blockComment: ['/*', '*/'],
  },
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
};

/**
 * Monarch tokenizer for syntax highlighting
 */
export const monarchTokensProvider: monaco.languages.IMonarchLanguage = {
  defaultToken: 'invalid',

  // Context roots - these are the special workflow context variables
  contextRoots: ['payload', 'vars', 'meta', 'error'],

  // Keywords
  keywords: ['true', 'false', 'null', 'and', 'or', 'not', 'in'],

  // Operators
  operators: [
    '=', '!=', '<', '>', '<=', '>=',
    '+', '-', '*', '/', '%',
    '&', '?', ':',
    '.', '[', ']',
    '~>', ':=',
  ],

  // Symbols used for operators
  symbols: /[=><!~?:&|+\-*\/\^%]+/,

  // Escape sequences
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // Block comments
      [/\/\*/, 'comment', '@comment'],

      // Context roots (payload, vars, meta, error) - highest priority
      [/\b(payload|vars|meta|error)\b/, 'variable.predefined'],

      // Function calls starting with $
      [/\$[a-zA-Z_][a-zA-Z0-9_]*/, 'function'],

      // Lambda arrow
      [/\$/, 'keyword'],

      // Keywords (true, false, null, and, or, not, in)
      [/\b(true|false|null)\b/, 'keyword.constant'],
      [/\b(and|or|not|in)\b/, 'keyword.operator'],

      // Numbers
      [/\b\d+\.\d+([eE][\-+]?\d+)?\b/, 'number.float'],
      [/\b\d+([eE][\-+]?\d+)?\b/, 'number'],
      [/\b0[xX][0-9a-fA-F]+\b/, 'number.hex'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-terminated string
      [/'([^'\\]|\\.)*$/, 'string.invalid'], // non-terminated string
      [/`([^`\\]|\\.)*$/, 'string.invalid'], // non-terminated backtick string
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
      [/`/, 'string.template', '@string_backtick'],

      // Identifiers - property access, variable names
      [/[a-zA-Z_][a-zA-Z0-9_]*/, {
        cases: {
          '@contextRoots': 'variable.predefined',
          '@keywords': 'keyword',
          '@default': 'identifier',
        },
      }],

      // Whitespace
      [/\s+/, 'white'],

      // Operators and delimiters
      [/[{}()\[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],

      // Delimiter: after property dot
      [/\./, 'delimiter'],

      // Delimiter: comma, semicolon, colon
      [/[,;:]/, 'delimiter'],
    ],

    // Block comment state
    comment: [
      [/[^\/*]+/, 'comment'],
      [/\/\*/, 'comment', '@push'], // nested comment
      [/\*\//, 'comment', '@pop'],
      [/[\/*]/, 'comment'],
    ],

    // Double-quoted string state
    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],

    // Single-quoted string state
    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],

    // Backtick string state (template literals)
    string_backtick: [
      [/[^\\`]+/, 'string.template'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/`/, 'string.template', '@pop'],
    ],
  },
};

/**
 * Register the JSONata workflow language with Monaco
 */
export function registerJsonataLanguage(monacoInstance: typeof monaco): void {
  // Check if already registered
  const languages = monacoInstance.languages.getLanguages();
  if (languages.some(lang => lang.id === LANGUAGE_ID)) {
    return;
  }

  // Register the language
  monacoInstance.languages.register({
    id: LANGUAGE_ID,
    extensions: ['.jsonata'],
    aliases: ['JSONata Workflow', 'jsonata-workflow'],
  });

  // Set language configuration
  monacoInstance.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration);

  // Set tokenizer
  monacoInstance.languages.setMonarchTokensProvider(LANGUAGE_ID, monarchTokensProvider);
}
