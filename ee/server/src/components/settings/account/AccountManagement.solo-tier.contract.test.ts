/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('AccountManagement solo tier contract', () => {
  const source = read('./AccountManagement.tsx');

  it('defines display names for all new Pro-gated tier features and keeps Solo copy', () => {
    expect(source).toContain("[TIER_FEATURES.INTEGRATIONS]: 'Integrations");
    expect(source).toContain("[TIER_FEATURES.EXTENSIONS]: 'Extensions");
    expect(source).toContain("[TIER_FEATURES.MANAGED_EMAIL]: 'Managed Email");
    expect(source).toContain("[TIER_FEATURES.SSO]: 'Single Sign-On");
    expect(source).toContain("[TIER_FEATURES.ADVANCED_ASSETS]: 'Advanced Assets");
    expect(source).toContain("[TIER_FEATURES.CLIENT_PORTAL_ADMIN]: 'Client Portal Admin");
    expect(source).toContain("[TIER_FEATURES.WORKFLOW_DESIGNER]: 'Workflow Designer");
    expect(source).toContain("[TIER_FEATURES.MOBILE_ACCESS]: 'Mobile Access");
    expect(source).toContain('Your Solo plan includes core PSA features. Upgrade to Pro for integrations, mobile access, and more.');
  });

  it('keeps the Solo upgrade and Pro downgrade controls gated by the account state', () => {
    expect(source).toContain("const canDowngradeToSolo = isPro && tierUpgradeFlowEnabled && (licenseInfo?.active_licenses ?? Number.POSITIVE_INFINITY) === 1;");
    expect(source).toContain("{isSolo && tierUpgradeFlowEnabled && !isSoloProTrial && (");
    expect(source).toContain('Upgrade to Pro');
    expect(source).toContain('downgrade-to-solo-btn');
  });

  it('renders AI Assistant purchase and active-state contract copy for every tier', () => {
    expect(source).toContain("const hasAiAssistant = hasAddOn(ADD_ONS.AI_ASSISTANT);");
    expect(source).toContain('AI Assistant is a separate paid add-on for Solo, Pro, and Premium tenants.');
    expect(source).toContain('Add AI Assistant');
    expect(source).toContain('AI Assistant (active)');
    expect(source).toContain('Cancel AI Assistant');
  });

  it('shows the Try Pro free CTA only for established Solo customers', () => {
    expect(source).toContain("const canStartSoloProTrial = isSolo && tierUpgradeFlowEnabled && subscriptionStatus === 'active' && !isSoloProTrial;");
    expect(source).toContain('Try Pro free');
    expect(source).toContain('start-solo-pro-trial-btn');
    expect(source).toContain('This trial is only available after your initial Solo trial has ended.');
  });
});
