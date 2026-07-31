/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = path.resolve(
  __dirname,
  '../../app/api/online-meetings/recordings/[artifactId]/route.ts',
);

describe('online meeting recording proxy route contract', () => {
  it('T063/T064/T065 streams Graph recording content through an authenticated tenant-scoped proxy', () => {
    const source = fs.readFileSync(routePath, 'utf8');

    expect(source).toContain('getCurrentUser');
    expect(source).toContain("return new NextResponse('Unauthorized', { status: 401 })");
    expect(source).toContain("createTenantKnex(tenant)");
    // tenant scoping of the artifact lookup now lives in the tenantDb facade
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain("db.table('online_meeting_artifacts as artifact')");
    expect(source).toContain(
      "db.tenantJoin(artifactQuery, 'online_meetings as meeting', 'artifact.meeting_id', 'meeting.meeting_id');",
    );
    // Portal visibility must be enforced from the server-known user type, never a
    // client-supplied query parameter.
    expect(source).toContain("(user as any).user_type === 'client'");
    expect(source).not.toContain("searchParams.get('portal')");
    expect(source).toContain('portalVisibilityEnabled');
    expect(source).toContain("return new NextResponse('Forbidden', { status: 403 })");
    // Internal users are gated on interaction:read.
    expect(source).toContain("hasPermission(user as any, 'interaction', 'read'");
    // Client users are checked for per-entity ownership of the meeting.
    expect(source).toContain('clientUserOwnsMeeting');
    // Locally downloaded recordings are preferred over a live Graph stream.
    expect(source).toContain('StorageService.downloadFile(artifact.file_id)');
    expect(source).toContain("'artifact.file_id'");
    expect(source).toContain('fetchMicrosoftGraphAppToken');
    expect(source).toContain('Authorization: `Bearer ${accessToken}`');
    expect(source).toContain('fetch(artifact.content_url');
    expect(source).toContain('new NextResponse(graphResponse.body as any');
    expect(source).toContain("headers.set('Content-Type'");
    expect(source).not.toContain('NextResponse.json({ content_url');
    expect(source).not.toContain('NextResponse.redirect(artifact.content_url');
  });
});
