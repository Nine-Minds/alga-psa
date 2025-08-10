# @alga/ui-kit

Primitives and tokens for Alga extensions. Zero-dependency React components with CSS variables.

## Install

- Import CSS variables once in your app:

```ts
import '@alga/ui-kit/tokens.css';
```

## Theme tokens

- Tokens are exposed as CSS variables (e.g., `--alga-primary`, `--alga-bg`, `--alga-fg`, `--alga-border`).
- When using the iframe bootstrap flow, the parent injects variables into `:root`, and the child app can also import `@alga/ui-kit/tokens.css` as a baseline.

## Usage

```tsx
import '@alga/ui-kit/tokens.css';
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
