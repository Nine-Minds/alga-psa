import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './AppointmentsPage.tsx'),
  'utf8',
);

describe('AppointmentsPage row actions contract', () => {
  it('uses a single MoreVertical dropdown trigger per row', () => {
    expect(source).toContain('MoreVertical');
    expect(source).toContain('appointment-row-actions-');
    expect(source).toContain('DropdownMenuTrigger');
  });

  it('exposes view/edit/cancel as DropdownMenuItem entries', () => {
    expect(source).toContain('view-appointment-');
    expect(source).toContain('edit-appointment-');
    expect(source).toContain('cancel-appointment-');
    // The view-details / edit / cancel ids should now live on DropdownMenuItem,
    // not on inline <Button> elements.
    expect(source).toMatch(/<DropdownMenuItem\s+id={`view-appointment-/);
    expect(source).toMatch(/<DropdownMenuItem\s+id={`edit-appointment-/);
    expect(source).toMatch(/<DropdownMenuItem\s+id={`cancel-appointment-/);
  });
});
