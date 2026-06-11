/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('online meeting calendar description mapping contract', () => {
  it('T051: both calendar mapping copies append the Teams join URL from online_meetings', () => {
    const paths = [
      'server/src/utils/calendar/eventMapping.ts',
      'packages/integrations/src/utils/calendar/eventMapping.ts',
    ];

    for (const relativePath of paths) {
      const source = read(relativePath);

      expect(source).toContain('buildScheduleEntryDescription(entry)');
      expect(source).toContain("knex('online_meetings')");
      expect(source).toContain('schedule_entry_id: entry.entry_id');
      expect(source).toContain('Join Teams Meeting: ${joinUrl}');
      expect(source).toContain('description,');
      expect(source).not.toContain("description: entry.notes || ''");
    }
  });
});
