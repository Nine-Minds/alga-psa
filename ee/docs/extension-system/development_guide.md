# Alga PSA Extension Development Guide - Descriptor Architecture

This guide provides a comprehensive overview of how to develop extensions for Alga PSA using the **descriptor-based architecture**. This approach eliminates module resolution issues, improves security, and reduces bundle sizes while providing a declarative interface for extension development.

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- Yarn or npm package manager
- Basic knowledge of TypeScript and JSON
- Understanding of declarative UI patterns
- Local instance of Alga PSA (for testing)

**Note**: React knowledge is helpful but not required since extensions use JSON descriptors instead of React components.

### Setting Up Your Development Environment

1. Install the Alga PSA Extension CLI:

```bash
npm install -g @algapsa/extension-cli
```

2. Create a new extension project:

```bash
alga-extension create my-extension
```

3. Navigate to your extension directory:

```bash
cd my-extension
```

4. Install dependencies:

```bash
npm install
```

### Project Structure

A descriptor-based extension has the following structure:

```
my-extension/
├── dist/                      # Compiled output (generated)
├── src/
│   ├── descriptors/           # JSON descriptors
│   │   ├── navigation/        # Navigation descriptors
│   │   │   └── NavItem.json
│   │   ├── pages/             # Page descriptors
│   │   │   └── HomePage.json
│   │   └── handlers/          # TypeScript handler modules
│   │       ├── navigation.ts
│   │       └── pageHandlers.ts
│   ├── index.ts               # Extension entry point (minimal)
│   └── types.ts               # TypeScript type definitions
├── alga-extension.json        # Extension manifest
├── package.json               # Node.js package file
├── tsconfig.json              # TypeScript configuration
└── README.md                  # Extension documentation
```

## Development Workflow

### 1. Define Your Extension Manifest

The `alga-extension.json` file is the heart of your descriptor-based extension. It defines metadata, required permissions, and descriptor components. Here's an example:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A sample descriptor-based extension for Alga PSA",
  "author": {
    "name": "Example, Inc.",
    "email": "dev@example.com"
  },
  "minAppVersion": "1.5.0",
  "tenantMode": "specific",
  "main": "index.js",
  "autoEnable": true,
  "permissions": [
    "ui:view",
    "company:read",
    "storage:read",
    "storage:write"
  ],
  "components": [
    {
      "type": "navigation",
      "slot": "main-navigation",
      "component": "descriptors/navigation/NavItem.json",
      "props": {
        "id": "my-extension-nav",
        "label": "My Extension",
        "icon": "StarIcon",
        "path": "/my-extension/home",
        "priority": 50
      }
    },
    {
      "type": "custom-page",
      "slot": "custom-pages",
      "component": "descriptors/pages/HomePage.json",
      "props": {
        "id": "my-extension-home",
        "path": "/my-extension/home",
        "title": "My Extension Home"
      }
    }
  ],
  "routes": [
    {
      "path": "/home",
      "component": "descriptors/pages/HomePage.json"
    }
  ]
}
```

### 2. Create Descriptor Files

Descriptor-based extensions use JSON files to define UI structure. Here's a navigation descriptor:

```json
// descriptors/navigation/NavItem.json
{
  "type": "button",
  "props": {
    "className": "w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
  },
  "handlers": {
    "module": "descriptors/handlers/navigation.js",
    "onClick": "navigateToHome"
  },
  "children": [
    {
      "type": "StarIcon",
      "props": { "className": "w-5 h-5" }
    },
    "My Extension"
  ]
}
```

And a page descriptor:

```json
// descriptors/pages/HomePage.json
{
  "type": "page",
  "meta": {
    "title": "My Extension Home",
    "description": "Welcome to my extension"
  },
  "content": {
    "type": "div",
    "props": { "className": "p-6" },
    "children": [
      {
        "type": "h1",
        "props": { "className": "text-2xl font-bold mb-4" },
        "children": ["Welcome to My Extension"]
      },
      {
        "type": "Card",
        "children": [
          {
            "type": "CardContent",
            "props": { "className": "p-4" },
            "children": [
              {
                "type": "p",
                "children": ["This is a descriptor-based extension page."]
              }
            ]
          }
        ]
      }
    ]
  },
  "handlers": {
    "module": "handlers/pageHandlers"
  }
}
```

### 3. Implement Handler Modules

Handler modules contain the business logic for your descriptors. They're written in TypeScript and compiled to JavaScript:

```typescript
// descriptors/handlers/navigation.ts
import { HandlerContext } from './types';

export function navigateToHome(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  // Use the extension context to navigate
  context.navigate('/msp/extensions/my-extension/home');
}

export function navigateToSettings(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/msp/extensions/my-extension/settings');
}
```

And page handlers:

```typescript
// descriptors/handlers/pageHandlers.ts
import { HandlerContext } from './types';

export async function loadData(context: HandlerContext) {
  try {
    const response = await context.api.get('/api/tickets/count');
    return response.data;
  } catch (error) {
    context.ui.toast('Failed to load data', 'error');
    return null;
  }
}

export async function saveSettings(event: SubmitEvent, context: HandlerContext) {
  event.preventDefault();
  const formData = new FormData(event.target as HTMLFormElement);
  
  try {
    await context.storage.set('settings', {
      apiEndpoint: formData.get('apiEndpoint'),
      refreshInterval: formData.get('refreshInterval')
    });
    context.ui.toast('Settings saved successfully', 'success');
  } catch (error) {
    context.ui.toast('Failed to save settings', 'error');
  }
}
```

### 4. Implement API Handlers

For custom API endpoints, create handler functions in the `src/handlers` directory:

```typescript
// src/handlers/customEndpoint.ts
import { APIHandlerContext } from '@algapsa/extension-sdk';

export async function handler(req: any, res: any, context: APIHandlerContext) {
  try {
    // Access request data
    const { param1, param2 } = req.body;
    
    // Use extension context
    const tenantId = context.tenantId;
    
    // Perform some operation
    const result = await context.apiClient.get(`/api/some-resource?tenant=${tenantId}`);
    
    // Process and return data
    return res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    context.logger.error('Error in custom endpoint', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
```

### 5. Build Your Extension

To build your extension for production:

```bash
npm run build
```

This compiles your TypeScript code and creates a distribution package in the `dist` directory.

### 6. Test Your Extension

#### Local Testing

1. Start the local dev server:

```bash
npm run dev
```

2. In your Alga PSA development environment, enable developer mode and load the local extension:

```bash
# In your Alga PSA directory
alga extension load-dev --path=/path/to/my-extension
```

#### Testing in a Production Environment

1. Package your extension:

```bash
alga-extension package
```

2. Upload the resulting `.algaext` file through the Alga PSA admin interface.

## Best Practices

### Performance

1. **Minimize Bundle Size**
   - Use dynamic imports for large dependencies
   - Split code into smaller chunks where possible
   - Remove unused dependencies

2. **Optimize Rendering**
   - Use React's memo, useMemo, and useCallback for performance-critical components
   - Implement proper loading states
   - Use virtualization for large lists

3. **Efficient API Usage**
   - Cache API responses when appropriate
   - Use pagination for large data sets
   - Implement request debouncing and throttling

### Security

1. **Follow the Principle of Least Privilege**
   - Only request permissions your extension actually needs
   - Use fine-grained permissions instead of broad categories

2. **Handle User Data Responsibly**
   - Don't store sensitive data in local storage
   - Sanitize user inputs
   - Use extension storage for persistent data

3. **Error Handling**
   - Implement proper error boundaries
   - Log errors appropriately
   - Provide user-friendly error messages

### UI/UX

1. **Follow Alga PSA Design Guidelines**
   - Use the provided UI components from `context.uiComponents`
   - Match the existing UI style and patterns
   - Use consistent icons and colors

2. **Responsive Design**
   - Ensure your UI works on different screen sizes
   - Test your extension on mobile devices
   - Implement proper layout for different widget sizes

3. **Accessibility**
   - Use semantic HTML
   - Ensure keyboard navigation works
   - Provide appropriate ARIA attributes

## Extension SDK API Reference

### ExtensionContext

The `ExtensionContext` object provides access to various services and utilities:

#### ApiClient

```typescript
interface ApiClient {
  get(url: string, config?: any): Promise<any>;
  post(url: string, data?: any, config?: any): Promise<any>;
  put(url: string, data?: any, config?: any): Promise<any>;
  delete(url: string, config?: any): Promise<any>;
  patch(url: string, data?: any, config?: any): Promise<any>;
}
```

#### Logger

```typescript
interface ExtensionLogger {
  debug(message: string, ...meta: any[]): void;
  info(message: string, ...meta: any[]): void;
  warn(message: string, ...meta: any[]): void;
  error(message: string, ...meta: any[]): void;
}
```

#### Storage

```typescript
interface ExtensionStorage {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  getKeys(): Promise<string[]>;
}
```

#### Events

```typescript
interface ExtensionEventBus {
  subscribe<T = any>(eventType: string, handler: (data: T) => void): () => void;
  publish<T = any>(eventType: string, data: T): Promise<void>;
}
```

#### UI Components

```typescript
interface ExtensionUIComponents {
  // Basic components
  Button: React.ComponentType<any>;
  Card: React.ComponentType<any>;
  Input: React.ComponentType<any>;
  Select: React.ComponentType<any>;
  Checkbox: React.ComponentType<any>;
  Dialog: React.ComponentType<any>;
  
  // Layout components
  Grid: React.ComponentType<any>;
  Stack: React.ComponentType<any>;
  
  // Data display
  Table: React.ComponentType<any>;
  DataGrid: React.ComponentType<any>;
  
  // Feedback
  Alert: React.ComponentType<any>;
  Toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
}
```

## Advanced Topics

### Workflow Extensions

Extensions can define custom workflow actions, triggers, and form templates:

```typescript
// src/handlers/customWorkflowAction.ts
import { WorkflowActionContext } from '@algapsa/extension-sdk';

export async function execute(inputs: any, context: WorkflowActionContext) {
  try {
    const { parameter1, parameter2 } = inputs;
    
    // Perform some action
    const result = await context.apiClient.post('/api/some-endpoint', {
      param1: parameter1,
      param2: parameter2,
    });
    
    // Return outputs for the workflow
    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    context.logger.error('Error in workflow action', error);
    return {
      success: false,
      error: error.message,
    };
  }
}
```

### Custom Form Fields

Extensions can provide custom form fields for use in the Alga PSA interface:

```tsx
// src/components/CustomField.tsx
import React, { useState } from 'react';
import { CustomFieldProps } from '@algapsa/extension-sdk';

const CustomField: React.FC<CustomFieldProps> = ({
  value,
  onChange,
  label,
  required,
  disabled,
  error,
  helperText,
}) => {
  const [internalValue, setInternalValue] = useState(value || '');
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    onChange(newValue);
  };
  
  return (
    <div className="custom-field">
      <label className={required ? 'required' : ''}>
        {label}
      </label>
      <input
        type="text"
        value={internalValue}
        onChange={handleChange}
        disabled={disabled}
        className={error ? 'error' : ''}
      />
      {helperText && (
        <div className="helper-text">{helperText}</div>
      )}
      {error && (
        <div className="error-text">{error}</div>
      )}
    </div>
  );
};

export default CustomField;
```

### Inter-Extension Communication

Extensions can communicate with each other through the event system:

```typescript
// Extension A
context.events.publish('extensionA:dataUpdated', { someData: 'value' });

// Extension B
context.events.subscribe('extensionA:dataUpdated', (data) => {
  console.log('Received data from Extension A:', data);
  // Do something with the data
});
```

### Extension Settings UI

Extensions can provide a settings UI component:

```tsx
// src/components/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { SettingsPageProps } from '@algapsa/extension-sdk';

const SettingsPage: React.FC<SettingsPageProps> = ({
  context,
  currentSettings,
  onSave,
}) => {
  const [settings, setSettings] = useState(currentSettings || {});
  
  const handleSave = async () => {
    try {
      await onSave(settings);
      context.uiComponents.Toast.success('Settings saved successfully');
    } catch (error) {
      context.uiComponents.Toast.error('Failed to save settings');
    }
  };
  
  return (
    <div className="settings-page">
      <h2>My Extension Settings</h2>
      
      <div className="form-group">
        <label>API Endpoint</label>
        <context.uiComponents.Input
          value={settings.apiEndpoint || ''}
          onChange={(e) => setSettings({...settings, apiEndpoint: e.target.value})}
        />
      </div>
      
      <div className="form-group">
        <label>Refresh Interval (minutes)</label>
        <context.uiComponents.Input
          type="number"
          value={settings.refreshInterval || 5}
          onChange={(e) => setSettings({
            ...settings, 
            refreshInterval: parseInt(e.target.value, 10)
          })}
        />
      </div>
      
      <context.uiComponents.Button onClick={handleSave}>
        Save Settings
      </context.uiComponents.Button>
    </div>
  );
};

export default SettingsPage;
```

## Troubleshooting

### Common Issues

1. **Extension Not Loading**
   - Check console for errors
   - Verify your manifest is valid
   - Ensure all required files are included in the package

2. **Permission Errors**
   - Make sure you've requested all needed permissions in your manifest
   - Check that users have the required roles to use your extension

3. **UI Components Not Rendering**
   - Verify component paths in your manifest
   - Check for React key warnings
   - Ensure proper error boundaries are in place

### Debugging Extensions

1. **Development Mode**
   - Enable extension developer mode in Alga PSA
   - Use the browser's developer tools console
   - Check the extension logs in the admin panel

2. **Logs**
   - Use `context.logger` for all logging
   - Set appropriate log levels for different environments
   - Include relevant context in log messages

## Publishing Your Extension

1. **Prepare Your Extension**
   - Update the version number in your manifest
   - Ensure all dependencies are correctly listed
   - Update the README with usage instructions

2. **Package Your Extension**
   ```bash
   alga-extension package
   ```

3. **Submit for Review**
   - If publishing to the Alga Extension Marketplace, submit your package for review
   - Provide documentation and testing instructions

4. **Private Distribution**
   - For private extensions, distribute the .algaext file directly
   - Instructions for installation via the admin interface

## Resources

- [Extension SDK Documentation](/docs/extension-sdk/)
- [Alga PSA API Reference](/docs/api-reference/)
- [UI Component Library](/docs/ui-components/)
- [Example Extensions Repository](https://github.com/algapsa/extension-examples)
- [Extension Development Community](https://community.algapsa.com/c/extension-development)