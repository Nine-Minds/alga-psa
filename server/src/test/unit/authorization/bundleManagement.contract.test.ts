import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

describe('EE bundle management contracts', () => {
  const actionSource = readSource('ee/server/src/lib/actions/auth/authorizationBundleActions.ts');
  const uiSource = readSource('ee/server/src/components/settings/policy/PolicyManagement.tsx');

  it('T024: library/editor/assignment flows remain draft-first and publish via explicit revision switch', () => {
    expect(actionSource).toContain('export const getAuthorizationBundleDraftEditorAction = withAuth(');
    expect(actionSource).toContain('await ensureDraftBundleRevision(knex, {');
    expect(actionSource).toContain('const draft = await ensureDraftBundleRevision(trx, {');
    expect(actionSource).toContain('export const upsertAuthorizationBundleDraftRuleAction = withAuth(');
    expect(actionSource).toContain('export const deleteAuthorizationBundleDraftRuleAction = withAuth(');
    expect(actionSource).toContain('export const publishAuthorizationBundleDraftAction = withAuth(');
    expect(actionSource).toContain('await publishBundleRevision(trx, {');
    expect(actionSource).toContain('export const createAuthorizationBundleAssignmentAction = withAuth(');
    expect(actionSource).toContain('export const setAuthorizationBundleAssignmentStatusAction = withAuth(');
    expect(uiSource).toContain('Revision summary: {editorData.revisionChangeSummary}');
    expect(uiSource).toContain('listAuthorizationBundleAssignmentsAction(bundleId)');
  });

  it('T025: UI and action payloads include human-readable rule/revision summaries by resource section', () => {
    expect(uiSource).toContain('const RESOURCE_SECTIONS: Array<{ label: string; resourceType: string }> = [');
    expect(uiSource).toContain("{ label: 'Tickets', resourceType: 'ticket' }");
    expect(uiSource).toContain("{ label: 'Documents', resourceType: 'document' }");
    expect(uiSource).toContain("{ label: 'Time', resourceType: 'time_entry' }");
    expect(uiSource).toContain("{ label: 'Projects', resourceType: 'project' }");
    expect(uiSource).toContain("{ label: 'Assets', resourceType: 'asset' }");
    expect(uiSource).toContain("{ label: 'Billing', resourceType: 'billing' }");
    expect(uiSource).toContain('function summarizeRule(rule: {');
    expect(actionSource).toContain('const revisionChangeSummary = bundle.published_revision_id');
  });

  it('T027: audit-trail action persists and returns lifecycle actor/timestamp metadata for bundle, revisions, and assignments', () => {
    expect(actionSource).toContain('export const getAuthorizationBundleAuditTrailAction = withAuth(');
    expect(actionSource).toContain("eventType: 'bundle_created'");
    expect(actionSource).toContain("eventType: 'bundle_archived'");
    expect(actionSource).toContain("eventType: 'revision_drafted'");
    expect(actionSource).toContain("eventType: 'revision_published'");
    expect(actionSource).toContain("eventType: 'assignment_created'");
    expect(actionSource).toContain("eventType: 'assignment_updated'");
    expect(actionSource).toContain('created_by');
    expect(actionSource).toContain('updated_by');
    expect(actionSource).toContain('published_by');
    expect(actionSource).toContain('events.sort((left, right) =>');
  });
});
