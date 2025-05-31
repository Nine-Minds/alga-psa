# Alga PSA Extension System

This directory contains the implementation of the Alga PSA extension system, which allows third-party developers to extend and enhance Alga PSA with custom functionality.

## Overview

The extension system is designed with a 80/20 approach, focusing on the features that deliver the most value with minimal implementation effort. It supports three main extension points:

1. **Tab Extensions** - Add new tabs to existing pages
2. **Navigation Extensions** - Add new items to the sidebar navigation
3. **Custom Page Extensions** - Create entirely new pages with custom routes

## Directory Structure

- `/lib/extensions/` - Main extension system directory
  - `/types.ts` - Core extension system types
  - `/registry.ts` - Extension registry for managing extension lifecycle
  - `/validator.ts` - Manifest validation utilities
  - `/errors.ts` - Extension-specific error classes
  - `/schemas/` - Validation schemas for manifests, permissions, etc.
  - `/storage/` - Extension data storage service
  - `/ui/` - UI extension components
    - `/tabs/` - Tab extension components
    - `/navigation/` - Navigation extension components
    - `/pages/` - Custom page extension components
  - `/example-integration/` - Example integrations for reference

## Using Extension Points

### Tab Extensions

Tab extensions allow you to add new tabs to existing pages like Billing, Tickets, etc. To integrate tab extensions:

```tsx
import { TabExtensionSlot } from '../lib/extensions/ui/tabs/TabExtensionSlot';

function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  // Get the current tab from URL query params
  const currentTab = searchParams.get('tab') || 'overview';
  
  // Handle tab change (including extension tabs)
  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.push(`${pathname}?${params.toString()}`);
  };
  
  return (
    <div className="billing-page">
      <h1>Billing</h1>
      
      <div className="tabs-container">
        <div className="flex">
          {/* Native tabs */}
          {nativeTabs.map(tab => (
            <button
              key={tab.id}
              className={currentTab === tab.id ? 'active' : ''}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          
          {/* Extension tabs */}
          <TabExtensionSlot 
            parentPage="billing" 
            currentTab={currentTab} 
            onTabChange={handleTabChange} 
          />
        </div>
      </div>
      
      {/* Tab content */}
      {currentTab === 'overview' && <BillingOverview />}
      {currentTab === 'invoices' && <Invoices />}
      {/* ... other native tab content ... */}
    </div>
  );
}
```

### Navigation Extensions

Navigation extensions allow you to add new items to the sidebar navigation. To integrate navigation extensions:

```tsx
import { NavigationSlot } from '../lib/extensions/ui/navigation/NavigationSlot';

function Sidebar({ sidebarOpen, setSidebarOpen }) {
  return (
    <aside className="sidebar">
      {/* Logo and native menu items */}
      <nav>
        <ul>
          {menuItems.map(renderMenuItem)}
        </ul>
        
        {/* Extension navigation items */}
        <div className="extension-nav">
          <h3 className={sidebarOpen ? 'block' : 'hidden'}>Extensions</h3>
          <NavigationSlot collapsed={!sidebarOpen} />
        </div>
      </nav>
    </aside>
  );
}
```

### Custom Page Extensions

Custom page extensions allow extensions to create entirely new pages with custom routes. The system already includes the necessary dynamic route handler at `/app/msp/extensions/[extensionId]/[...path]/page.tsx`, so no additional integration is needed.

## Extension Manifest

Extensions define their components and functionality through a manifest file. Here's an example manifest with all supported extension points:

```json
{
  "name": "example-extension",
  "description": "An example extension",
  "version": "1.0.0",
  "author": "Example Author",
  "homepage": "https://example.com/extensions/example",
  "license": "MIT",
  "main": "index.js",
  "components": [
    {
      "type": "tab-extension",
      "slot": "billing-tabs",
      "component": "./components/BillingReportTab",
      "props": {
        "id": "custom-billing-report",
        "parentPage": "billing",
        "label": "Custom Reports",
        "icon": "FileTextIcon",
        "priority": 50,
        "permissions": ["view:billing"]
      }
    },
    {
      "type": "navigation-item",
      "slot": "main-navigation",
      "props": {
        "id": "custom-nav",
        "label": "Custom Reports",
        "icon": "BarChartIcon",
        "path": "/msp/extensions/example-extension/reports",
        "priority": 80,
        "permissions": ["view:reports"]
      }
    },
    {
      "type": "custom-page",
      "slot": "custom-pages",
      "component": "./components/ReportsPage",
      "props": {
        "id": "custom-reports-page",
        "path": "/reports",
        "title": "Custom Reports",
        "icon": "FileTextIcon",
        "permissions": ["view:reports"]
      }
    }
  ],
  "permissions": [
    "view:billing",
    "view:reports",
    "storage:read",
    "storage:write"
  ],
  "settings": [
    {
      "key": "refreshInterval",
      "type": "number",
      "label": "Refresh Interval (seconds)",
      "description": "How often to refresh data",
      "default": 300
    }
  ]
}
```

## Extension Development

For detailed information on developing extensions, refer to the following documentation:

- [Extension System Overview](/ee/docs/extension-system/overview.md)
- [Implementation Plan](/ee/docs/extension-system/implementation_plan.md)
- [Development Guide](/ee/docs/extension-system/development_guide.md)
- [Manifest Schema](/ee/docs/extension-system/manifest_schema.md)

## Integration with Alga PSA

The extension system is fully integrated with Alga PSA's existing systems:

1. **UI Reflection System** - All extension components are registered with Alga's UI reflection system
2. **Tenant Isolation** - Proper tenant isolation is enforced at all levels
3. **Permission System** - Extension permissions integrate with Alga's RBAC system
4. **Styling** - Extensions follow Alga's styling conventions and UI patterns