import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

describe('EE bundle management contracts', () => {
  const actionSource = readSource('ee/server/src/lib/actions/auth/authorizationBundleActions.ts');
  const uiSource = readSource('ee/server/src/components/settings/policy/PolicyManagement.tsx');
  const policyLocale = JSON.parse(readSource('server/public/locales/en/msp/admin.json')).policyManagement;

  it('T024: library/editor/assignment flows remain draft-first and publish via explicit revision switch', () => {
    expect(actionSource).toContain('export const createAuthorizationBundleAction = withAuth(');
    expect(actionSource).toContain('export const getAuthorizationBundleDraftEditorAction = withAuth(');
    expect(actionSource).toContain('await ensureDraftBundleRevision(knex, {');
    expect(actionSource).toContain('const draft = await ensureDraftBundleRevision(trx, {');
    expect(actionSource).toContain('export const upsertAuthorizationBundleDraftRuleAction = withAuth(');
    expect(actionSource).toContain('export const deleteAuthorizationBundleDraftRuleAction = withAuth(');
    expect(actionSource).toContain('export const publishAuthorizationBundleDraftAction = withAuth(');
    expect(actionSource).toContain('await publishBundleRevision(trx, {');
    expect(actionSource).toContain('export const createAuthorizationBundleAssignmentAction = withAuth(');
    expect(actionSource).toContain('export const setAuthorizationBundleAssignmentStatusAction = withAuth(');
    expect(uiSource).toContain('id="authorization-bundle-create-button"');
    expect(uiSource).toContain('id="authorization-bundle-publish-draft-button"');
    expect(uiSource).toContain(
      "{t('policyManagement.editor.revisionSummary', { summary: editorData.revisionChangeSummary })}"
    );
    expect(policyLocale.editor.revisionSummary).toBe('Revision summary: {{summary}}');
    expect(uiSource).toContain('listAuthorizationBundleAssignmentsAction(bundleId)');
    expect(uiSource).toContain('id="authorization-bundle-assignment-add-button"');
  });

  it('T025: UI and action payloads include human-readable rule/revision summaries by resource section', () => {
    expect(uiSource).toContain('const RESOURCE_SECTIONS: Array<{ labelKey: string; resourceType: string }> = [');
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.tickets', resourceType: 'ticket' }");
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.documents', resourceType: 'document' }");
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.time', resourceType: 'time_entry' }");
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.projects', resourceType: 'project' }");
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.assets', resourceType: 'asset' }");
    expect(uiSource).toContain("{ labelKey: 'policyManagement.resourceSections.billing', resourceType: 'billing' }");
    expect(policyLocale.resourceSections).toEqual({
      tickets: 'Tickets',
      documents: 'Documents',
      time: 'Time',
      projects: 'Projects',
      assets: 'Assets',
      billing: 'Billing',
    });
    expect(uiSource).toContain('function summarizeRule(rule: {');
    expect(uiSource).toContain("t('policyManagement.editor.rule.selectedClientScopes')");
    expect(uiSource).toContain("t('policyManagement.editor.rule.selectedBoardScopes')");
    expect(uiSource).toContain("t('policyManagement.editor.rule.redactedFields')");
    expect(policyLocale.editor.rule.selectedClientScopes).toBe('Selected client scopes');
    expect(policyLocale.editor.rule.selectedBoardScopes).toBe('Selected board scopes');
    expect(policyLocale.editor.rule.redactedFields).toBe('Redacted fields');
    expect(actionSource).toContain('selectedClientIds: string[];');
    expect(actionSource).toContain('selectedBoardIds: string[];');
    expect(actionSource).toContain('redactedFields: string[];');
    expect(actionSource).toContain('availableClients: Array<{');
    expect(actionSource).toContain('availableBoards: Array<{');
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
