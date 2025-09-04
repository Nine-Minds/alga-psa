import React from 'react';
import { Alert, Badge, Button, Card, DataTable, Input, Stack, Text } from '@alga-psa/ui-kit';

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>UI Kit Gallery</h1>
      <Stack gap={12}>
        <section>
          <h2>Alert</h2>
          <Alert variant="info">This is an info alert.</Alert>
        </section>
        <section>
          <h2>Badge</h2>
          <Badge>Default</Badge>
        </section>
        <section>
          <h2>Buttons</h2>
          <Stack direction="row" gap={8}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Stack>
        </section>
        <section>
          <h2>Card</h2>
          <Card>
            <Text>Card content</Text>
          </Card>
        </section>
        <section>
          <h2>DataTable</h2>
          <DataTable data={[{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]} columns={[{ key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }]} />
        </section>
        <section>
          <h2>Input</h2>
          <Input placeholder="Type here" />
        </section>
        <section>
          <h2>Stack + Text</h2>
          <Stack>
            <Text size="sm">Small text</Text>
            <Text>Default text</Text>
            <Text size="lg">Large text</Text>
          </Stack>
        </section>
      </Stack>
    </div>
  );
}
