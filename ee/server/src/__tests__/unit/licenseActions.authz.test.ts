import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  getSession: vi.fn(),
  getConnection: vi.fn(),
  tenantDb: vi.fn(),
  stripeCalls: vi.fn(),
  emailCalls: vi.fn(),
}));

vi.mock('../../lib/license/get-license-usage', () => ({ getLicenseUsage: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.read,
  checkAccountManagementUpdatePermission: mocks.update,
  checkAccountManagementDeletePermission: mocks.del,
}));
// Every Stripe service method is recorded; none do real work.
vi.mock('../../lib/stripe/StripeService', () => ({
  AppleIapBillingError: class AppleIapBillingError extends Error {},
  getStripeService: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => async (...args: unknown[]) => {
          mocks.stripeCalls(String(prop), ...args);
          return prop === 'isConfigured' ? false : {};
        },
      }
    ),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (...args: unknown[]) => {
    mocks.tenantDb(...args);
    throw new Error('db touched');
  },
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/email', () => ({ sendCancellationFeedbackEmail: mocks.emailCalls }));
vi.mock('@alga-psa/email/sendCancellationRequestEmail', () => ({
  sendCancellationRequestEmail: mocks.emailCalls,
}));

import * as actions from '../../lib/actions/license-actions';

type Level = 'read' | 'update' | 'delete';

// Single source of truth for classification. The source guard below fails when an
// exported action is missing from this table, forcing a decision for new actions.
const CLASSIFICATION: Record<string, { level: Level; call: () => Promise<any> }> = {
  getInvoicePreviewAction: { level: 'read', call: () => actions.getInvoicePreviewAction(2) },
  getAddLicensesPreviewAction: { level: 'read', call: () => actions.getAddLicensesPreviewAction(1) },
  getLicensePricingAction: { level: 'read', call: () => actions.getLicensePricingAction() },
  getSubscriptionInfoAction: { level: 'read', call: () => actions.getSubscriptionInfoAction() },
  getPaymentMethodInfoAction: { level: 'read', call: () => actions.getPaymentMethodInfoAction() },
  getRecentInvoicesAction: { level: 'read', call: () => actions.getRecentInvoicesAction() },
  getScheduledLicenseChangesAction: { level: 'read', call: () => actions.getScheduledLicenseChangesAction() },
  getUpgradePreviewAction: { level: 'read', call: () => actions.getUpgradePreviewAction('pro') },
  getIntervalSwitchPreviewAction: { level: 'read', call: () => actions.getIntervalSwitchPreviewAction('year') },
  getIapBillingContextAction: { level: 'read', call: () => actions.getIapBillingContextAction() },
  createLicenseCheckoutSessionAction: { level: 'update', call: () => actions.createLicenseCheckoutSessionAction(3) },
  addLicensesAction: { level: 'update', call: () => actions.addLicensesAction(1) },
  reduceLicenseCountAction: { level: 'update', call: () => actions.reduceLicenseCountAction(1) },
  createCustomerPortalSessionAction: { level: 'update', call: () => actions.createCustomerPortalSessionAction() },
  sendCancellationFeedbackAction: { level: 'update', call: () => actions.sendCancellationFeedbackAction('too pricey') },
  upgradeTierAction: { level: 'update', call: () => actions.upgradeTierAction('pro') },
  downgradeTierAction: { level: 'update', call: () => actions.downgradeTierAction() },
  purchaseAddOnAction: { level: 'update', call: () => actions.purchaseAddOnAction('ai_assistant' as any) },
  cancelAddOnAction: { level: 'update', call: () => actions.cancelAddOnAction('ai_assistant' as any) },
  switchBillingIntervalAction: { level: 'update', call: () => actions.switchBillingIntervalAction('year') },
  startSoloProTrialAction: { level: 'update', call: () => actions.startSoloProTrialAction() },
  startIapUpgradeAction: { level: 'update', call: () => actions.startIapUpgradeAction('pro') },
  cancelIapTransitionAction: { level: 'update', call: () => actions.cancelIapTransitionAction() },
  cancelSubscriptionAction: { level: 'delete', call: () => actions.cancelSubscriptionAction() },
};

// Exports that are not account-management billing actions (own auth model, no mutation).
const NON_BILLING_EXPORTS = new Set(['getLicenseUsageAction']);

const ROLES: Record<string, Record<Level, boolean>> = {
  readOnly: { read: true, update: false, delete: false },
  updater: { read: true, update: true, delete: false },
  deleter: { read: true, update: false, delete: true },
  admin: { read: true, update: true, delete: true },
};

function setRole(role: Record<Level, boolean>) {
  mocks.read.mockResolvedValue(role.read);
  mocks.update.mockResolvedValue(role.update);
  mocks.del.mockResolvedValue(role.delete);
}

function sideEffects() {
  return mocks.stripeCalls.mock.calls.length + mocks.getConnection.mock.calls.length + mocks.tenantDb.mock.calls.length + mocks.emailCalls.mock.calls.length;
}

const isPermissionDenied = (r: any) => r?.success === false && /permission/i.test(String(r?.error));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: 'u1', tenant: 't1', email: 'a@b.c' } });
  mocks.getConnection.mockResolvedValue({});
});

async function expectDenied(name: string) {
  const result = await CLASSIFICATION[name].call();
  expect(isPermissionDenied(result), `${name} should be denied, got ${JSON.stringify(result)}`).toBe(true);
  expect(sideEffects(), `${name} must not touch Stripe/DB/email when denied`).toBe(0);
}

async function expectAllowed(name: string) {
  // A throw past the gate (e.g. the stubbed DB) also proves the gate was passed.
  const result = await CLASSIFICATION[name].call().catch(() => ({ success: true }));
  expect(isPermissionDenied(result), `${name} should pass the permission gate, got ${JSON.stringify(result)}`).toBe(false);
}

const namesAt = (...levels: Level[]) =>
  Object.keys(CLASSIFICATION).filter((n) => levels.includes(CLASSIFICATION[n].level));

describe('license-actions account_management authorization', () => {
  describe.each(namesAt('update', 'delete'))('read-only role: %s', (name) => {
    it('is denied with no Stripe/DB/email side effects', async () => {
      setRole(ROLES.readOnly);
      await expectDenied(name);
    });
  });

  describe.each(namesAt('read'))('read-only role: %s', (name) => {
    it('passes the permission gate', async () => {
      setRole(ROLES.readOnly);
      await expectAllowed(name);
    });
  });

  describe.each(namesAt('update'))('update role: %s', (name) => {
    it('is allowed', async () => {
      setRole(ROLES.updater);
      await expectAllowed(name);
    });
  });

  it('update role cannot cancel the subscription', async () => {
    setRole(ROLES.updater);
    await expectDenied('cancelSubscriptionAction');
  });

  it('delete role can cancel the subscription', async () => {
    setRole(ROLES.deleter);
    await expectAllowed('cancelSubscriptionAction');
  });

  it('delete-only role cannot perform update-class actions', async () => {
    setRole(ROLES.deleter);
    for (const name of namesAt('update')) {
      await expectDenied(name);
    }
  });

  it('admin passes every gate', async () => {
    setRole(ROLES.admin);
    for (const name of Object.keys(CLASSIFICATION)) {
      await expectAllowed(name);
    }
  });
});

describe('license-actions source guard', () => {
  const file = path.resolve(__dirname, '../../lib/actions/license-actions.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

  const exported = new Map<string, ts.FunctionDeclaration>();
  source.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      exported.set(node.name.text, node);
    }
  });

  function gateCalls(fn: ts.FunctionDeclaration) {
    const levels: string[] = [];
    let direct = false;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const id = n.expression.text;
        if (id === 'hasAccountManagementAccess') {
          const arg = n.arguments[0];
          levels.push(arg && ts.isStringLiteral(arg) ? arg.text : '<non-literal>');
        }
        if (id === 'checkAccountManagementPermission') direct = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    return { levels, direct };
  }

  it('every exported action is classified (new actions must be added to CLASSIFICATION)', () => {
    const unclassified = [...exported.keys()].filter(
      (n) => !(n in CLASSIFICATION) && !NON_BILLING_EXPORTS.has(n)
    );
    expect(unclassified).toEqual([]);
    expect(Object.keys(CLASSIFICATION).filter((n) => !exported.has(n))).toEqual([]);
  });

  it('no exported action calls checkAccountManagementPermission directly', () => {
    const direct = [...exported].filter(([, fn]) => gateCalls(fn).direct).map(([n]) => n);
    expect(direct).toEqual([]);
  });

  it('each classified action gates at exactly its declared level', () => {
    for (const [name, { level }] of Object.entries(CLASSIFICATION)) {
      const { levels } = gateCalls(exported.get(name)!);
      expect(levels, name).toEqual([level]);
    }
  });

  it('mutating actions never use the read level', () => {
    for (const [name, { level }] of Object.entries(CLASSIFICATION)) {
      if (level === 'read') continue;
      expect(gateCalls(exported.get(name)!).levels, name).not.toContain('read');
    }
  });

  it('helper-less exports are not tenant-parameterised mutations', () => {
    // 'use server' exports are public endpoints: none may take a tenantId argument.
    for (const [name, fn] of exported) {
      const params = fn.parameters.map((p) => p.name.getText(source));
      expect(params, name).not.toContain('tenantId');
    }
  });
});
