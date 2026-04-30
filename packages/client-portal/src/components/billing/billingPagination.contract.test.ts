import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const invoicesSource = fs.readFileSync(
  path.resolve(__dirname, './InvoicesTab.tsx'),
  'utf8',
);
const quotesSource = fs.readFileSync(
  path.resolve(__dirname, './QuotesTab.tsx'),
  'utf8',
);
const devicesSource = fs.readFileSync(
  path.resolve(__dirname, '../assets/ClientDevicesPage.tsx'),
  'utf8',
);
const projectsSource = fs.readFileSync(
  path.resolve(__dirname, '../projects/ProjectsOverviewPage.tsx'),
  'utf8',
);

const sources = {
  invoices: invoicesSource,
  quotes: quotesSource,
  devices: devicesSource,
  projects: projectsSource,
};

describe('client portal pagination contract', () => {
  // Pagination control hides itself when totalPages <= 1 unless onItemsPerPageChange
  // is supplied. Wiring page-size state guarantees the page-size selector + counter
  // are visible even on small datasets.
  it.each(Object.entries(sources))('%s page wires pageSize state to DataTable', (_name, source) => {
    expect(source).toContain('const [pageSize, setPageSize]');
    expect(source).toContain('onItemsPerPageChange={(size) =>');
    expect(source).toContain('pageSize={pageSize}');
  });
});
