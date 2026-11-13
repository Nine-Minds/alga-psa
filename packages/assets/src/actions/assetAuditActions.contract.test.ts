/**
 * RBAC contract for the site audit server actions.
 *
 * The web surfaces drive the same lifecycle the v1 controller does, so they
 * must enforce the same permissions: `asset:read` to look, `asset:update` to
 * start, mark, add, undo, complete or cancel. Asserted against the source the
 * way assetAuthorization.contract.test.ts does — a behavioural test here would
 * need a database, and the risk being guarded is an action shipping without its
 * gate, which is visible in the text.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'assetAuditActions.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The body of one exported action, for per-action assertions. */
function actionBody(name: string): string {
  const start = source.indexOf(`export const ${name} = withAuth(`);
  expect(start, `${name} is not an exported withAuth action`).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const READ_ACTIONS = ['listAssetAudits', 'getAssetAudit'];
const UPDATE_ACTIONS = [
  'previewAssetAuditScope',
  'startAssetAudit',
  'markAssetAuditItem',
  'addUnexpectedAuditAsset',
  'unmarkAssetAuditItem',
  'completeAssetAudit',
  'cancelAssetAudit',
];

describe('asset audit action contracts', () => {
  it('runs every action through withAuth, under "use server"', () => {
    expect(source.startsWith("'use server';")).toBe(true);
    for (const name of [...READ_ACTIONS, ...UPDATE_ACTIONS]) {
      expect(source).toContain(`export const ${name} = withAuth(`);
    }
  });

  it('gates the reads on asset:read', () => {
    for (const name of READ_ACTIONS) {
      expect(actionBody(name), name).toContain("denyUnless(user, 'read')");
    }
  });

  it('gates every write on asset:update', () => {
    for (const name of UPDATE_ACTIONS) {
      expect(actionBody(name), name).toContain("denyUnless(user, 'update')");
    }
  });

  it('refuses before touching the service, and returns the refusal as a value', () => {
    for (const name of [...READ_ACTIONS, ...UPDATE_ACTIONS]) {
      const body = actionBody(name);
      const denial = body.indexOf('const denied = await denyUnless');
      const returnsDenial = body.indexOf('if (denied) return denied;');
      const work = body.indexOf('toAuditResult');
      expect(denial, name).toBeGreaterThan(-1);
      expect(returnsDenial, name).toBeGreaterThan(denial);
      expect(work, name).toBeGreaterThan(returnsDenial);
    }
  });

  it('asks hasPermission for the asset resource, never a bespoke one', () => {
    expect(source).toContain("hasPermission(user, 'asset', action)");
    expect(source).not.toMatch(/hasPermission\(user, '(?!asset')/);
  });

  it('marks from the web as manual, since this surface has no scanner', () => {
    for (const name of ['markAssetAuditItem', 'addUnexpectedAuditAsset']) {
      expect(actionBody(name), name).toContain("method: 'manual'");
    }
  });

  it('validates every id and payload with zod before the service sees it', () => {
    expect(actionBody('getAssetAudit')).toContain('auditIdSchema.parse(auditId)');
    expect(actionBody('startAssetAudit')).toContain('startAssetAuditSchema.parse(input)');
    expect(actionBody('listAssetAudits')).toContain('assetAuditListFiltersSchema.parse(filters)');
    expect(actionBody('previewAssetAuditScope')).toContain('assetAuditScopeSchema.parse(scope)');
    expect(actionBody('unmarkAssetAuditItem')).toContain('.parse(assetId)');
  });

  it('exposes the asset:read probe the client Audits tab gates on', () => {
    expect(source).toContain('export const hasAssetAuditReadAccess = withAuth(');
    expect(source).toContain("hasPermission(user, 'asset', 'read')");
  });

  it('reaches the lifecycle through the package service, not the server adapter', () => {
    expect(source).toContain("from '../lib/audits/service'");
    expect(source).not.toContain('lib/api/services');
  });
});
