# @alga/ui-kit

Primitives and tokens for Alga extensions. Zero-dependency React components with CSS variables.

## Install

- Import CSS variables once in your app:

```ts
import '@alga/ui-kit/theme.css';
```

## Theme Tokens

Tokens are exposed as CSS variables. When using the iframe bootstrap flow, the parent injects variables into `:root`.

| Variable | Light | Dark | Purpose |
|----------|-------|------|---------|
| `--alga-bg` | `#ffffff` | `#0b0f14` | Background |
| `--alga-fg` | `#111111` | `#e5e7eb` | Foreground/text |
| `--alga-muted` | `#f5f5f7` | `#0f1720` | Muted background |
| `--alga-muted-fg` | `#4b5563` | `#9ca3af` | Muted text |
| `--alga-primary` | `#9855ee` | `#8a4dea` | Primary (purple) |
| `--alga-primary-foreground` | `#ffffff` | `#ffffff` | Text on primary |
| `--alga-secondary` | `#53d7fa` | `#40cff9` | Secondary (blue) |
| `--alga-secondary-foreground` | `#111111` | `#0b0f14` | Text on secondary |
| `--alga-border` | `#e5e7eb` | `#1f2937` | Borders |
| `--alga-radius` | `8px` | `8px` | Border radius |
| `--alga-danger` | `#dc2626` | `#ef4444` | Danger/error |
| `--alga-warning` | `#d97706` | `#f59e0b` | Warning |
| `--alga-success` | `#16a34a` | `#22c55e` | Success |

## Components

```tsx
import {
  Button,           // Primary, secondary, danger variants
  Input,            // Text input
  CustomSelect,     // Dropdown with search
  Card,             // Container
  Alert,            // Notifications
  Text,             // Typography
  Stack,            // Layout spacing
  Badge,            // Tags/labels (tone: success, warning, danger)
  DataTable,        // Paginated table with sorting/search
  Dialog,           // Base modal
  ConfirmDialog,    // Confirm/cancel modal
  Spinner,          // Loading spinner (purple ring, blue sector)
  LoadingIndicator, // Spinner with optional text
} from '@alga/ui-kit';
```

## Usage Examples

### Basic Layout

```tsx
import '@alga/ui-kit/theme.css';
import { Card, Stack, Text, Button, Badge, Input, DataTable } from '@alga/ui-kit';

function Example() {
  const data = [
    { id: 1, name: 'Alpha', count: 3 },
    { id: 2, name: 'Beta', count: 10 },
  ];
  const columns = [
    { key: 'id', header: 'ID', width: 80, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'count', header: 'Count', sortable: true },
  ] as const;

  return (
    <Card>
      <Stack gap={12}>
        <Text as="strong" weight={600} style={{ fontSize: 16, lineHeight: '24px' }}>Demo</Text>
        <Stack direction="row" gap={8}>
          <Input placeholder="Search" />
          <Button>Submit</Button>
          <Badge tone="success">Active</Badge>
        </Stack>
        <DataTable data={data as any} columns={columns as any} initialSortKey="name" />
      </Stack>
    </Card>
  );
}
```

### Spinner / Loading

```tsx
import { Spinner, LoadingIndicator } from '@alga/ui-kit';

// Basic spinner (sizes: 'xs' | 'sm' | 'md' | 'lg')
<Spinner size="md" />

// With text, inline layout (default)
<LoadingIndicator text="Loading..." />

// Stacked layout (spinner above text)
<LoadingIndicator text="Please wait..." layout="stacked" size="lg" />
```

### Confirmation Dialog

```tsx
import { ConfirmDialog, Button } from '@alga/ui-kit';

function DeleteButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Delete</Button>
      <ConfirmDialog
        isOpen={open}
        title="Delete Item"
        message="Are you sure? This action cannot be undone."
        variant="danger"
        onConfirm={() => { /* handle delete */ setOpen(false); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
```

## Extension Theme Bridge

For extensions running in iframes, add this to receive theme from the host:

```tsx
function applyTheme(vars: Record<string, string>) {
  Object.entries(vars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

function initializeThemeBridge() {
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (data?.alga === true && data?.version === '1' && data?.type === 'theme') {
      applyTheme(data.payload || {});
    }
  });
  window.parent.postMessage({ alga: true, version: '1', type: 'ready' }, '*');
}

initializeThemeBridge();
```
