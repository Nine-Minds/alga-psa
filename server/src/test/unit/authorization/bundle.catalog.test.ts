import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_CONSTRAINT_CATALOG,
  AUTHORIZATION_TEMPLATE_CATALOG,
  assertBundleRuleCatalogInput,
} from 'server/src/lib/authorization/bundles/catalog';

describe('authorization bundle catalog', () => {
  it('supports the v1 typed relationship template catalog', () => {
    expect(AUTHORIZATION_TEMPLATE_CATALOG.has('own')).toBe(true);
    expect(AUTHORIZATION_TEMPLATE_CATALOG.has('own_or_assigned')).toBe(true);
    expect(AUTHORIZATION_TEMPLATE_CATALOG.has('own_or_managed')).toBe(true);
    expect(AUTHORIZATION_TEMPLATE_CATALOG.has('selected_clients')).toBe(true);
    expect(AUTHORIZATION_TEMPLATE_CATALOG.has('selected_boards')).toBe(true);
  });

  it('supports high-value guard/redaction constraint templates', () => {
    expect(AUTHORIZATION_CONSTRAINT_CATALOG.has('not_self_approver')).toBe(true);
    expect(AUTHORIZATION_CONSTRAINT_CATALOG.has('client_visible_only')).toBe(true);
    expect(AUTHORIZATION_CONSTRAINT_CATALOG.has('hide_sensitive_fields')).toBe(true);
  });

  it('rejects unsupported template and constraint keys', () => {
    expect(() =>
      assertBundleRuleCatalogInput({
        templateKey: 'invalid-template',
      })
    ).toThrow(/Unsupported authorization template key/);

    expect(() =>
      assertBundleRuleCatalogInput({
        templateKey: 'own',
        constraintKey: 'invalid-constraint',
      })
    ).toThrow(/Unsupported authorization constraint key/);
  });
});
