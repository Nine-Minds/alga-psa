module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'prettier' // Integrate prettier rules
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier' // Use prettier's rules (disables conflicting ESLint rules)
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    // project: './tsconfig.json', // Optional: Enable if you need rules requiring type info
  },
  env: {
    es6: true,
    // Add other environments if needed (e.g., 'node' if using Node.js specific features outside AS)
  },
  rules: {
    // --- Prettier Integration ---
    'prettier/prettier': 'warn', // Show Prettier violations as warnings

    // --- General Best Practices ---
    'no-console': 'off', // Allow console.log/error (often used via host `log`)
    'no-debugger': 'warn', // Warn about debugger statements
    'no-unused-vars': 'off', // Handled by @typescript-eslint/no-unused-vars
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }], // Warn on unused vars, allow underscore prefix

    // --- AssemblyScript Specific Considerations ---
    // '@typescript-eslint/no-non-null-assertion': 'off', // AS often requires `!` for type narrowing after checks
    '@typescript-eslint/no-explicit-any': 'warn', // Avoid 'any' where possible
    '@typescript-eslint/explicit-module-boundary-types': 'off', // Can be verbose for simple AS functions
    '@typescript-eslint/ban-ts-comment': ['warn', { // Allow @ts-ignore for decorators like @json
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true, // Allow basic @ts-ignore (needed for @json, @external etc.)
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 3,
      }],

    // Add other project-specific rules here
  },
  ignorePatterns: [
    'node_modules/',
    'build/',
    'assembly/common/abort.ts', // Often standard, less need to lint heavily
    '*.d.ts'
  ],
};