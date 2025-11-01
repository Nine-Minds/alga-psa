# Custom ESLint Rules

This directory contains custom ESLint rules specific to the Alga PSA project.

## Available Rules

### `migration-filename`

Enforces proper naming conventions for database migration files.

**Purpose**: Ensures all database migrations follow the `yyyymmddhhmm_description.cjs` naming pattern and prevents future-dated migrations.

**Documentation**: See [migration-filename.md](./migration-filename.md) for detailed information.

**Example violations**:
```bash
# Wrong format (14 digits instead of 12)
server/migrations/20241002132600_add_tax_rates_tables.cjs
# Error: Migration file must be named with yyyymmddhhmm prefix

# Future timestamp
server/migrations/202511011001_create_extension_storage_tables.cjs
# Error: Migration file has a timestamp in the future (2025-11-01 14:01)
```

### `map-return-type`

Validates return type annotations for map functions.

### `check-required-props`

Ensures required props are defined in React components.

### `no-legacy-ext-imports`

Prevents imports from legacy extension system paths, enforcing use of v2 APIs.

## Testing

Each rule has an accompanying test file (`.test.js`) that validates its behavior:

```bash
node eslint-plugin-custom-rules/migration-filename.test.js
```

## Adding New Rules

1. Create a new `.js` file in this directory with your rule implementation
2. Export an object with `meta` and `create` properties
3. Add the rule to `index.js`:
   ```javascript
   import myNewRule from "./my-new-rule.js";

   export default {
     rules: {
       // ... existing rules
       "my-new-rule": myNewRule,
     },
   };
   ```
4. Configure the rule in the main `eslint.config.js`
5. Create a test file to validate the rule's behavior
6. Document the rule in a markdown file

## Rule Structure

Each rule should follow this structure:

```javascript
export default {
  meta: {
    type: "problem", // or "suggestion" or "layout"
    docs: {
      description: "Brief description of what the rule does",
      recommended: true,
    },
    schema: [], // JSON schema for rule options
    messages: {
      messageId: "Error message template with {{placeholders}}",
    },
  },

  create(context) {
    return {
      // AST node visitors
      NodeType(node) {
        // Rule logic
        if (violation) {
          context.report({
            node,
            messageId: "messageId",
            data: {
              placeholder: "value",
            },
          });
        }
      },
    };
  },
};
```

## Resources

- [ESLint Rule API Documentation](https://eslint.org/docs/latest/extend/custom-rules)
- [AST Explorer](https://astexplorer.net/) - Visualize JavaScript AST
- [ESTree Spec](https://github.com/estree/estree) - AST node type specifications
