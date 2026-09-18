import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readOptimizedTicketActionsSource(): string {
  const filePath = path.resolve(__dirname, './optimizedTicketActions.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('MSP consolidated ticket data comment author map contract', () => {
  it('fetches comment authors without the picker user_type/is_inactive filters', () => {
    const source = readOptimizedTicketActionsSource();

    expect(source).toContain('const extraAuthorIds =');
    expect(source).toContain('.map((comment) => comment.user_id)');
    expect(source).toContain("await tenantScopedTable(trx, 'users', tenant).whereIn('user_id', extraAuthorIds)");

    const authorFetch = source.slice(
      source.indexOf('const extraCommentAuthors'),
      source.indexOf('const authorContactIds')
    );
    expect(authorFetch).not.toContain("where('user_type', 'internal')");
    expect(authorFetch).not.toContain("where('is_inactive', false)");
  });

  it('merges comment authors into the display map with contact avatars for client users', () => {
    const source = readOptimizedTicketActionsSource();

    expect(source).toContain('const usersWithAvatars = [');
    expect(source).toContain('...extraCommentAuthors.map((author: any) => ({');
    expect(source).toContain("getEntityImageUrlsBatch('contact', authorContactIds, tenant)");
    expect(source).toContain("author.user_type === 'client' && author.contact_id");
    expect(source).toContain('[...users.map((user: any) => user.user_id), ...extraAuthorIds]');
    expect(source).toContain('const userMap = usersWithAvatars.reduce(');
  });

  it('keeps the agent pickers sourced from internal active users only', () => {
    const source = readOptimizedTicketActionsSource();

    expect(source).toContain("where('user_type', 'internal')");
    expect(source).toContain("where('is_inactive', false)");
    expect(source).toContain('const agentOptions = (users as Array<');
    expect(source).toContain('availableAgents: users,');
    expect(source).not.toContain('availableAgents: usersWithAvatars');
    expect(source).not.toContain('const agentOptions = (usersWithAvatars');
  });
});
