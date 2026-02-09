import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTicketOrigin } from '../ticketOrigin';

function collectFilesRecursively(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe('ticket origin migration posture', () => {
  it('T070: no new migration is required for MVP; feature works with existing ticket/user fields', () => {
    const derivedWithoutTicketOriginField = getTicketOrigin({
      source: null,
      email_metadata: null,
      entered_by_user_type: 'client',
    });

    expect(derivedWithoutTicketOriginField).toBe(TICKET_ORIGINS.CLIENT_PORTAL);

    const migrationRoots = [
      path.resolve(__dirname, '../../../../../server/migrations'),
      path.resolve(__dirname, '../../../../../ee/server/migrations'),
    ];

    const migrationFiles = migrationRoots
      .flatMap((root) => collectFilesRecursively(root))
      .filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.js'));

    const ticketOriginMentions = migrationFiles.filter((filePath) =>
      fs.readFileSync(filePath, 'utf8').includes('ticket_origin')
    );

    expect(ticketOriginMentions).toEqual([]);
  });
});
