# DataTable Integration Guide

This guide explains how to integrate and use the DataTable component in Alga PSA extensions through the descriptor-based architecture.

## Overview

The extension system provides seamless integration with Alga PSA's DataTable component, offering rich functionality including sorting, pagination, filtering, and custom cell rendering - all through declarative JSON descriptors.

## DataTable Descriptor Structure

### Basic Table Structure

```json
{
  "type": "table",
  "data": {
    "key": "agreements",
    "source": "api",
    "endpoint": "/api/extensions/{{extensionId}}/agreements"
  },
  "columns": [
    {
      "key": "name",
      "header": "Agreement Name",
      "sortable": true
    }
  ],
  "pagination": {
    "enabled": true,
    "pageSize": 10
  }
}
```

### Component Registration

The ComponentRegistry automatically maps table descriptors to the real DataTable component:

```typescript
// Automatic mapping in ComponentRegistry
this.register('DataTable', DataTable);
this.register('table', DataTable); // Both 'table' and 'DataTable' work
```

## Data Loading

### API Data Source

```json
{
  "data": {
    "key": "tableData",
    "source": "api",
    "endpoint": "/api/extensions/{{extensionId}}/agreements",
    "params": {
      "page": 1,
      "limit": 50
    }
  }
}
```

### Expected API Response Format

The API should return data in one of these formats:

```json
// Format 1: Direct array
[
  {"id": "1", "name": "Agreement 1"},
  {"id": "2", "name": "Agreement 2"}
]

// Format 2: Wrapped in data property (preferred)
{
  "success": true,
  "data": [
    {"id": "1", "name": "Agreement 1"},
    {"id": "2", "name": "Agreement 2"}
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "extensionId": "uuid"
  }
}
```

### Automatic Data Loading

The system automatically:

1. **Finds Tables**: Recursively discovers all table descriptors in the page
2. **Loads Data**: Makes API calls for each table's data source
3. **Handles Responses**: Extracts data from both array and wrapped formats
4. **Updates State**: Sets loading states and handles errors

## Column Configuration

### Simple Columns

For basic text display:

```json
{
  "key": "name",
  "header": "Agreement Name",
  "sortable": true,
  "width": "200px"
}
```

### Custom Cell Rendering

For complex content with styling and interactions:

```json
{
  "key": "name",
  "header": "Agreement Name",
  "sortable": true,
  "cell": {
    "type": "a",
    "props": {
      "className": "text-blue-600 hover:underline cursor-pointer font-medium"
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
}
```

### Status Badges

Dynamic styling based on data:

```json
{
  "key": "status",
  "header": "Status", 
  "cell": {
    "type": "Badge",
    "props": {
      "variant": "{{row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}}"
    },
    "children": ["{{row.status}}"]
  }
}
```

### Formatted Numbers

With proper number formatting:

```json
{
  "key": "amount",
  "header": "Amount",
  "cell": {
    "type": "span",
    "children": ["{{row.currency}} {{row.amount.toLocaleString()}}"]
  }
}
```

### Action Buttons

Interactive buttons in cells:

```json
{
  "key": "actions",
  "header": "Actions",
  "cell": {
    "type": "Button",
    "props": {
      "variant": "ghost",
      "size": "sm"
    },
    "handlers": {
      "click": {
        "handler": "showActions",
        "params": {
          "id": "{{row.id}}"
        }
      }
    },
    "children": ["Actions"]
  }
}
```

## DataTable Features

### Pagination

```json
{
  "pagination": {
    "enabled": true,
    "pageSize": 25,
    "pageSizeOptions": [10, 25, 50, 100]
  }
}
```

### Sorting

```json
{
  "sorting": {
    "enabled": true,
    "defaultSort": {
      "field": "name",
      "order": "asc"
    }
  }
}
```

### Filtering

```json
{
  "filtering": {
    "enabled": true,
    "filters": [
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          {"label": "All", "value": ""},
          {"label": "Active", "value": "active"},
          {"label": "Inactive", "value": "inactive"}
        ]
      },
      {
        "key": "vendor",
        "label": "Vendor",
        "type": "text"
      }
    ]
  }
}
```

## Event Handlers

### Table Context

Handlers receive a table context with useful methods:

```typescript
interface TableContext extends HandlerContext {
  table: {
    selectedRows: any[];
    setSelectedRows: (rows: any[]) => void;
    refresh: () => void;
  };
}
```

### Refresh Handler

```typescript
export async function refreshTable(event: MouseEvent, context: TableContext) {
  try {
    context.ui.toast('Refreshing data...', 'info');
    
    // Trigger table refresh
    context.table.refresh();
    
    context.ui.toast('Data refreshed successfully', 'success');
  } catch (error) {
    console.error('Failed to refresh:', error);
    context.ui.toast('Failed to refresh data', 'error');
  }
}
```

### Row Selection Handler

```typescript
export async function handleSelection(event: MouseEvent, context: TableContext) {
  const selectedCount = context.table.selectedRows.length;
  
  if (selectedCount === 0) {
    context.ui.toast('Please select items first', 'warning');
    return;
  }
  
  context.ui.toast(`Processing ${selectedCount} selected items`, 'info');
  // Process selected rows...
}
```

## Complete Example

Here's a comprehensive table descriptor:

```json
{
  "type": "Card",
  "children": [
    {
      "type": "CardHeader",
      "children": [
        {
          "type": "div",
          "props": {
            "className": "flex justify-between items-center"
          },
          "children": [
            {
              "type": "CardTitle",
              "children": ["Agreements"]
            },
            {
              "type": "div",
              "props": {
                "className": "flex gap-2"
              },
              "children": [
                {
                  "type": "Button",
                  "props": {
                    "variant": "outline",
                    "size": "sm"
                  },
                  "handlers": {
                    "click": "refreshTable"
                  },
                  "children": ["Refresh"]
                },
                {
                  "type": "Button",
                  "props": {
                    "variant": "outline", 
                    "size": "sm"
                  },
                  "handlers": {
                    "click": "exportData"
                  },
                  "children": ["Export"]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "CardContent",
      "props": {
        "className": "p-0"
      },
      "children": [
        {
          "type": "table",
          "data": {
            "key": "agreements",
            "source": "api", 
            "endpoint": "/api/extensions/{{extensionId}}/agreements"
          },
          "columns": [
            {
              "key": "name",
              "header": "Agreement Name",
              "sortable": true,
              "cell": {
                "type": "a",
                "props": {
                  "className": "text-blue-600 hover:underline cursor-pointer font-medium"
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
              "key": "vendor",
              "header": "Vendor",
              "sortable": true
            },
            {
              "key": "status",
              "header": "Status",
              "sortable": true,
              "cell": {
                "type": "Badge",
                "props": {
                  "variant": "{{row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}}"
                },
                "children": ["{{row.status}}"]
              }
            },
            {
              "key": "amount",
              "header": "Amount",
              "cell": {
                "type": "span",
                "props": {
                  "className": "font-medium"
                },
                "children": ["{{row.currency}} {{row.amount.toLocaleString()}}"]
              }
            },
            {
              "key": "actions",
              "header": "",
              "cell": {
                "type": "Button",
                "props": {
                  "variant": "ghost",
                  "size": "sm"
                },
                "handlers": {
                  "click": {
                    "handler": "showActions",
                    "params": {
                      "id": "{{row.id}}"
                    }
                  }
                },
                "children": ["Actions"]
              }
            }
          ],
          "pagination": {
            "enabled": true,
            "pageSize": 10,
            "pageSizeOptions": [10, 25, 50]
          },
          "sorting": {
            "enabled": true,
            "defaultSort": {
              "field": "name",
              "order": "asc"
            }
          },
          "filtering": {
            "enabled": true,
            "filters": [
              {
                "key": "status",
                "label": "Status",
                "type": "select",
                "options": [
                  {"label": "All", "value": ""},
                  {"label": "Active", "value": "active"},
                  {"label": "Inactive", "value": "inactive"},
                  {"label": "Pending", "value": "pending"}
                ]
              }
            ]
          }
        }
      ]
    }
  ]
}
```

## Loading States

### Automatic Loading States

The system automatically shows loading spinners:

```typescript
// Automatic loading state display
if (loading[dataKey]) {
  return (
    <div className="p-4 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
      <div className="text-gray-600">Loading data...</div>
    </div>
  );
}
```

### Error States

Automatic error handling and display:

```typescript
// Automatic error state display  
if (errors[dataKey]) {
  return (
    <div className="p-4 text-center text-red-600">
      <div className="mb-2">❌ Failed to load data</div>
      <div className="text-sm">{errors[dataKey].message}</div>
    </div>
  );
}
```

## Performance Optimization

### Data Transformation

Transform data in API responses rather than in templates:

```typescript
// Good: Transform in API
const processedData = rawData.map(item => ({
  ...item,
  statusText: item.status === 'active' ? 'Active' : 'Inactive',
  formattedAmount: `${item.currency} ${item.amount.toLocaleString()}`
}));

// Better than complex templates
"{{row.statusText}}" // vs "{{row.status === 'active' ? 'Active' : 'Inactive'}}"
```

### Column Optimization

- Use simple columns when possible
- Minimize complex template expressions
- Cache expensive calculations in data transformation

### Memory Management

The system automatically:
- Cleans up event handlers when tables unmount
- Revokes blob URLs used for dynamic imports
- Manages template evaluation contexts

## Troubleshooting

### Common Issues

1. **Empty Table**: Check API response format and data key
2. **Template Not Working**: Verify variable names match data structure  
3. **Handlers Not Firing**: Ensure handler names match exported functions
4. **Styling Issues**: Verify ComponentRegistry has real components registered

### Debug Mode

Enable debug logging:

```typescript
console.log(`[DataTable] Rendering with data:`, {
  key: dataKey,
  tableData,
  loading: loading[dataKey]
});
```

### Data Flow Debugging

1. **API Response**: Check network tab for API responses
2. **Data Storage**: Check console logs for data setting
3. **Template Evaluation**: Check template substitution logs
4. **Component Props**: Check final DataTable props

This integration provides a powerful, declarative way to create rich data tables while maintaining the security and simplicity benefits of the descriptor-based architecture.