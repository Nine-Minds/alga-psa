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
    expect(source).toContain("'artifact.tenant': tenant");
    expect(source).toContain("request.nextUrl.searchParams.get('portal') === 'true'");
    expect(source).toContain('portalVisibilityEnabled');
    expect(source).toContain("return new NextResponse('Forbidden', { status: 403 })");
    expect(source).toContain('fetchMicrosoftGraphAppToken');
    expect(source).toContain('Authorization: `Bearer ${accessToken}`');
    expect(source).toContain('fetch(artifact.content_url');
    expect(source).toContain('new NextResponse(graphResponse.body as any');
    expect(source).toContain("headers.set('Content-Type'");
    expect(source).not.toContain('NextResponse.json({ content_url');
    expect(source).not.toContain('NextResponse.redirect(artifact.content_url');
  });
});
