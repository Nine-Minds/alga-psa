# Extension Template System Guide

This guide explains the template variable substitution and expression evaluation system used in Alga PSA extension descriptors.

## Overview

The extension template system allows you to create dynamic, data-driven UIs using JSON descriptors with embedded template expressions. This system supports both simple variable substitution and complex JavaScript expression evaluation.

## Template Syntax

### Basic Syntax

Template expressions are enclosed in double curly braces:

```
{{expression}}
```

### Simple Variable Access

```json
{
  "type": "span",
  "children": ["{{row.name}}"]
}
```

### Complex Expressions

```json
{
  "type": "Badge",
  "props": {
    "variant": "{{row.status === 'active' ? 'success' : 'warning'}}"
  }
}
```

## Available Variables

### Extension Context

- `{{extensionId}}` - Current extension UUID
- `{{extension.version}}` - Extension version
- `{{extension.config.*}}` - Extension configuration values

### Row Data (Table Cells)

- `{{row.*}}` - Any property from the current table row
- `{{value}}` - The cell's raw value
- `{{index}}` - Row index (0-based)

### URL Parameters

- `{{params.id}}` - Route parameter (e.g., agreement ID)
- `{{params.*}}` - Any URL parameter

### User Context

- `{{user.id}}` - Current user ID
- `{{user.tenantId}}` - Current tenant ID
- `{{user.permissions}}` - User permissions array

## Expression Types

### 1. Property Access

Simple property access from available variables:

```json
{
  "children": ["{{row.name}}"]
}
```

### 2. Method Calls

Call methods on values:

```json
{
  "children": ["{{row.amount.toLocaleString()}}"]
}
```

### 3. Conditional Expressions

Ternary operators for conditional logic:

```json
{
  "props": {
    "className": "{{row.isActive ? 'text-green-600' : 'text-gray-400'}}"
  }
}
```

### 4. Complex Conditionals

Multiple conditions:

```json
{
  "props": {
    "variant": "{{row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}}"
  }
}
```

### 5. String Concatenation

Combine multiple values:

```json
{
  "children": ["{{row.currency}} {{row.amount}}"]
}
```

### 6. Mathematical Operations

Perform calculations:

```json
{
  "children": ["Total: {{row.quantity * row.price}}"]
}
```

## Implementation Examples

### Table Cell Templates

```json
{
  "type": "table",
  "columns": [
    {
      "key": "name",
      "header": "Name",
      "cell": {
        "type": "a",
        "props": {
          "className": "text-blue-600 hover:underline"
        },
        "handlers": {
          "click": {
            "handler": "navigateToDetail",
            "params": {
              "id": "{{row.id}}"
            }
          }
        },
        "children": ["{{row.name}}"]
      }
    },
    {
      "key": "status",
      "header": "Status",
      "cell": {
        "type": "Badge",
        "props": {
          "variant": "{{row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}}"
        },
        "children": ["{{row.status.toUpperCase()}}"]
      }
    },
    {
      "key": "amount",
      "header": "Amount",
      "cell": {
        "type": "span",
        "props": {
          "className": "{{row.amount > 1000 ? 'font-bold text-green-600' : 'text-gray-900'}}"
        },
        "children": ["{{row.currency}} {{row.amount.toLocaleString()}}"]
      }
    }
  ]
}
```

### API Endpoint Templates

```json
{
  "data": {
    "key": "agreements",
    "source": "api",
    "endpoint": "/api/extensions/{{extensionId}}/agreements/{{params.id}}"
  }
}
```

### Handler Parameter Templates

```json
{
  "handlers": {
    "click": {
      "handler": "updateRecord",
      "params": {
        "id": "{{row.id}}",
        "status": "{{row.status === 'active' ? 'inactive' : 'active'}}"
      }
    }
  }
}
```

### Form Value Templates

```json
{
  "type": "input",
  "props": {
    "value": "{{form.values.name || row.defaultName}}",
    "placeholder": "Enter {{row.type}} name"
  }
}
```

## Expression Evaluation Engine

### Safe Evaluation

The template system uses a safe evaluation approach:

1. **Simple Properties**: Direct property access for basic variables
2. **Complex Expressions**: Function constructor with controlled context
3. **Error Handling**: Graceful fallback to original template on errors

### Evaluation Context

Each template is evaluated with a controlled context:

```typescript
const evalContext = {
  row: currentRowData,
  value: cellValue,
  index: rowIndex,
  params: urlParams,
  extensionId: currentExtensionId,
  user: currentUser
};
```

### Security Measures

1. **Sandboxed Execution**: Templates run in isolated contexts
2. **No Global Access**: No access to global objects or functions
3. **Error Boundaries**: Failed evaluations fall back to original template
4. **Input Validation**: Template syntax is validated before evaluation

## Advanced Features

### 1. Date Formatting

```json
{
  "children": ["{{new Date(row.createdAt).toLocaleDateString()}}"]
}
```

### 2. Array Operations

```json
{
  "children": ["{{row.tags.join(', ')}}"]
}
```

### 3. Nested Property Access

```json
{
  "children": ["{{row.user.profile.displayName}}"]
}
```

### 4. Type Checking

```json
{
  "children": ["{{typeof row.value === 'number' ? row.value.toFixed(2) : row.value}}"]
}
```

## Error Handling

### Template Evaluation Errors

When template evaluation fails:

1. **Console Warning**: Error is logged to browser console
2. **Fallback Display**: Original template string is displayed
3. **Graceful Degradation**: UI continues to function

Example error handling:

```typescript
try {
  const result = evaluateTemplate(template, context);
  return result;
} catch (error) {
  console.warn(`Template evaluation failed: ${error.message}`);
  return originalTemplate; // Show {{row.name}} instead of crashing
}
```

### Common Error Scenarios

1. **Undefined Properties**: `{{row.nonexistent}}` → Shows template string
2. **Method Errors**: `{{row.number.toLocaleString()}}` when `row.number` is null
3. **Syntax Errors**: `{{row.name +}}` → Invalid JavaScript syntax

## Performance Considerations

### 1. Template Caching

Templates are parsed and cached for performance:

```typescript
const templateCache = new Map<string, CompiledTemplate>();
```

### 2. Evaluation Optimization

- Simple property access uses direct object access
- Complex expressions use Function constructor only when needed
- Results are cached when possible

### 3. Memory Management

- Template evaluation contexts are cleaned up after use
- Blob URLs for dynamic imports are revoked to prevent memory leaks

## Debugging Templates

### Debug Mode

Enable template debugging in development:

```typescript
console.log(`[Template] Processing: ${template}`);
console.log(`[Template] Context:`, context);
console.log(`[Template] Result:`, result);
```

### Common Debugging Steps

1. **Check Variable Names**: Ensure variable names match data structure
2. **Verify Context**: Log the evaluation context to see available variables
3. **Test Expressions**: Test complex expressions in browser console first
4. **Fallback Values**: Use fallback values for potentially undefined properties

```json
{
  "children": ["{{row.name || 'Unnamed Item'}}"]
}
```

## Best Practices

### 1. Keep Templates Simple

Prefer simple expressions over complex logic:

```json
// Good
"{{row.isActive ? 'Active' : 'Inactive'}}"

// Better - handle in data transformation
"{{row.statusText}}"
```

### 2. Use Fallback Values

Always provide fallbacks for optional data:

```json
"{{row.description || 'No description available'}}"
```

### 3. Type Safety

Check types before method calls:

```json
"{{typeof row.amount === 'number' ? row.amount.toLocaleString() : row.amount}}"
```

### 4. Meaningful Variable Names

Use descriptive variable names in context:

```typescript
// Good context structure
{
  row: agreementData,
  user: currentUser,
  config: extensionConfig
}
```

### 5. Error Boundaries

Wrap risky operations:

```json
"{{row.data && row.data.value ? row.data.value.toString() : 'N/A'}}"
```

## Migration Guide

### From Static Content

Replace static content with templates:

```json
// Before
{
  "children": ["Agreement Name"]
}

// After
{
  "children": ["{{row.name}}"]
}
```

### From Hardcoded Values

Replace hardcoded extension references:

```json
// Before
{
  "endpoint": "/api/extensions/my-extension/data"
}

// After
{
  "endpoint": "/api/extensions/{{extensionId}}/data"
}
```

This template system provides a powerful, secure way to create dynamic UIs while maintaining the simplicity and security benefits of the descriptor-based architecture.