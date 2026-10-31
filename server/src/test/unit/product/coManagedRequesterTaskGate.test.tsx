/** @vitest-environment jsdom */
// CM L4c: the portal task-thread button is gated by useCapability('co-managed') (admits), never a raw release flag.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// One module instance for the hook and the bootstrap context, whatever the package resolution is.
vi.mock('@alga-psa/ui/hooks', async () => ({ useCapability: (await import('../../../../../packages/ui/src/hooks/useCapability')).useCapability }));
import { FeatureFlagBootstrapProvider } from '../../../../../packages/ui/src/capability/bootstrapContext';
import { RequesterTaskConversation, RequesterTaskConversationProvider } from '../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation';

const Button = () => <button>Conversation</button>;
const view = (flags?: Record<string, boolean | string>) => {
  const tree = <RequesterTaskConversationProvider component={Button}><RequesterTaskConversation projectId="p" taskId="t" /></RequesterTaskConversationProvider>;
  return render(flags ? <FeatureFlagBootstrapProvider initialFeatureFlags={flags}>{tree}</FeatureFlagBootstrapProvider> : tree);
};

describe('requester task conversation button gating', () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it('is absent with the flag off (nothing bootstrapped)', () => {
    view();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent when only the release flag is on: the raw flag is not the capability', () => {
    view({ 'release-v2-0-feature': true });
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent with the flag on but no entitlement (served, not admitted)', () => {
    view({ 'capability:co-managed': true, 'capability:co-managed:admit': false });
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent with FORCE_CAPABILITIES=co-managed:off', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCE_CAPABILITIES', 'co-managed:off');
    view();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent when admitted but the application supplied no implementation', () => {
    render(<FeatureFlagBootstrapProvider initialFeatureFlags={{ 'capability:co-managed': true, 'capability:co-managed:admit': true }}><RequesterTaskConversation projectId="p" taskId="t" /></FeatureFlagBootstrapProvider>);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is present only when the capability admits', () => {
    view({ 'capability:co-managed': true, 'capability:co-managed:admit': true });
    expect(screen.getByRole('button', { name: 'Conversation' })).toBeTruthy();
  });
});
