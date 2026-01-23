/**
 * Monaco Editor Theme for JSONata Workflow Expressions
 *
 * Provides light and dark theme variants with consistent colors
 * matching the workflow designer's visual style.
 */

import type * as monaco from 'monaco-editor';

export const LIGHT_THEME_NAME = 'jsonata-workflow-light';
export const DARK_THEME_NAME = 'jsonata-workflow-dark';

/**
 * Light theme definition
 */
export const lightTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    // Context roots - blue (matches payload/vars in workflow)
    { token: 'variable.predefined', foreground: '2563eb', fontStyle: 'bold' },

    // Functions - purple
    { token: 'function', foreground: '7c3aed' },

    // Keywords and operators
    { token: 'keyword', foreground: 'db2777' },
    { token: 'keyword.constant', foreground: 'dc2626' },
    { token: 'keyword.operator', foreground: 'db2777', fontStyle: 'bold' },

    // Strings - green
    { token: 'string', foreground: '059669' },
    { token: 'string.template', foreground: '059669' },
    { token: 'string.escape', foreground: '0d9488' },
    { token: 'string.invalid', foreground: 'dc2626', fontStyle: 'underline' },

    // Numbers - orange
    { token: 'number', foreground: 'ea580c' },
    { token: 'number.float', foreground: 'ea580c' },
    { token: 'number.hex', foreground: 'ea580c' },

    // Identifiers - default text
    { token: 'identifier', foreground: '374151' },

    // Operators
    { token: 'operator', foreground: '6b7280' },

    // Delimiters and brackets
    { token: 'delimiter', foreground: '6b7280' },
    { token: '@brackets', foreground: '6b7280' },

    // Comments
    { token: 'comment', foreground: '9ca3af', fontStyle: 'italic' },

    // Invalid tokens
    { token: 'invalid', foreground: 'dc2626', fontStyle: 'underline' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#374151',
    'editor.lineHighlightBackground': '#f9fafb',
    'editorCursor.foreground': '#2563eb',
    'editor.selectionBackground': '#bfdbfe',
    'editor.inactiveSelectionBackground': '#e5e7eb',
    'editorLineNumber.foreground': '#9ca3af',
    'editorLineNumber.activeForeground': '#6b7280',
    'editorBracketMatch.background': '#dbeafe',
    'editorBracketMatch.border': '#93c5fd',
    'editorError.foreground': '#dc2626',
    'editorWarning.foreground': '#d97706',
    'editorInfo.foreground': '#2563eb',
  },
};

/**
 * Dark theme definition
 */
export const darkTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // Context roots - blue (matches payload/vars in workflow)
    { token: 'variable.predefined', foreground: '60a5fa', fontStyle: 'bold' },

    // Functions - purple
    { token: 'function', foreground: 'a78bfa' },

    // Keywords and operators
    { token: 'keyword', foreground: 'f472b6' },
    { token: 'keyword.constant', foreground: 'f87171' },
    { token: 'keyword.operator', foreground: 'f472b6', fontStyle: 'bold' },

    // Strings - green
    { token: 'string', foreground: '34d399' },
    { token: 'string.template', foreground: '34d399' },
    { token: 'string.escape', foreground: '2dd4bf' },
    { token: 'string.invalid', foreground: 'f87171', fontStyle: 'underline' },

    // Numbers - orange
    { token: 'number', foreground: 'fb923c' },
    { token: 'number.float', foreground: 'fb923c' },
    { token: 'number.hex', foreground: 'fb923c' },

    // Identifiers - default text
    { token: 'identifier', foreground: 'd1d5db' },

    // Operators
    { token: 'operator', foreground: '9ca3af' },

    // Delimiters and brackets
    { token: 'delimiter', foreground: '9ca3af' },
    { token: '@brackets', foreground: '9ca3af' },

    // Comments
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },

    // Invalid tokens
    { token: 'invalid', foreground: 'f87171', fontStyle: 'underline' },
  ],
  colors: {
    'editor.background': '#1f2937',
    'editor.foreground': '#d1d5db',
    'editor.lineHighlightBackground': '#374151',
    'editorCursor.foreground': '#60a5fa',
    'editor.selectionBackground': '#3b82f680',
    'editor.inactiveSelectionBackground': '#4b5563',
    'editorLineNumber.foreground': '#6b7280',
    'editorLineNumber.activeForeground': '#9ca3af',
    'editorBracketMatch.background': '#1e40af40',
    'editorBracketMatch.border': '#3b82f6',
    'editorError.foreground': '#f87171',
    'editorWarning.foreground': '#fbbf24',
    'editorInfo.foreground': '#60a5fa',
  },
};

/**
 * Register both themes with Monaco
 */
export function registerJsonataThemes(monacoInstance: typeof monaco): void {
  monacoInstance.editor.defineTheme(LIGHT_THEME_NAME, lightTheme);
  monacoInstance.editor.defineTheme(DARK_THEME_NAME, darkTheme);
}
