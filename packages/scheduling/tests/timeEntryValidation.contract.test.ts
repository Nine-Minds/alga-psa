import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('time entry service validation contract', () => {
  it('keeps service required in both dialog and inline form validation', () => {
    const dialogSource = readSource('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx');
    const formSource = readSource('../src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx');

    expect(dialogSource).toContain("toast.error('Please select a service before saving time entries');");
    expect(formSource).toContain("defaultValue: 'Service is required for time entries'");
    expect(formSource).toContain("defaultValue: 'Service'");
    expect(formSource).toContain('<span className="text-red-500">*</span>');
  });
});
