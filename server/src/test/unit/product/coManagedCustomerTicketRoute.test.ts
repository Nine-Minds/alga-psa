import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// The customer route is an async server component with a large data fan-out; its co-managed wiring is asserted
// from the source, and the rendered Co-managed section / audience control are covered by
// coManagedTicketSection.test.tsx and coManagedLocalTicketDataSource.test.tsx.
const page = readFileSync(path.resolve(__dirname, '../../../app/msp/tickets/[id]/page.tsx'), 'utf8');

it('no longer mounts the stacked co-managed panel above the native ticket screen', () => {
  expect(page).not.toMatch(/CoManagedTicketPanel/);
  expect(page).not.toMatch(/CoManagedFeatureBoundary/);
});

it('wraps the native screen in the local co-managed data source only for the co_managed product', () => {
  expect(page).toMatch(/productCode === 'co_managed'\s*\?\s*<CoManagedLocalTicketDataSourceProvider ticketId=\{id\} readOnly=\{workspaceReadOnly\}>\{ticketScreen\}<\/CoManagedLocalTicketDataSourceProvider>\s*:\s*ticketScreen/);
  expect(page.match(/<MspTicketDetailsContainerClient/g)).toHaveLength(1);
});
