import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(
  __dirname,
  '../../../components/dashboard/AlgadeskDashboard.tsx',
);

function readSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

describe('Algadesk dashboard contract', () => {
  it('T007: includes ticket and email summaries', () => {
    const source = readSource();
    expect(source).toContain('Open tickets');
    expect(source).toContain('Awaiting customer');
    expect(source).toContain('Awaiting internal');
    expect(source).toContain('Email channel health');
    expect(source).toContain('Recently updated tickets');
  });

  it('T007: excludes PSA-only widgets', () => {
    const source = readSource();
    expect(source).not.toContain('Billing');
    expect(source).not.toContain('Projects');
    expect(source).not.toContain('Assets');
    expect(source).not.toContain('Schedule');
    expect(source).not.toContain('Workflow');
    expect(source).not.toContain('Chat');
  });
});
