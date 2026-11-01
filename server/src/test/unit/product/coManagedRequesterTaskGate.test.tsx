/** @vitest-environment jsdom */
// CM L4c: the portal task-thread button needs the co-managed capability to SERVE (useCapability, never a raw
// release flag) AND the server's shared-work answer for the task. A customer requester is served but never
// admitted; a PSA sponsor is admitted but its native projects are not shared work.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// One module instance for the hook and the bootstrap context, whatever the package resolution is.
vi.mock('@alga-psa/ui/hooks', async () => ({ useCapability: (await import('../../../../../packages/ui/src/hooks/useCapability')).useCapability }));
import { FeatureFlagBootstrapProvider } from '../../../../../packages/ui/src/capability/bootstrapContext';
import { RequesterTaskConversation, RequesterTaskConversationProvider, RequesterSharedTasksProvider } from '../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation';

const Button = () => <button>Conversation</button>;
const load = async () => [];
const served = { 'capability:co-managed': true, 'capability:co-managed:admit': false };
const view = (flags?: Record<string, boolean | string>, shared: string[] | null = ['t']) => {
  const tree = <RequesterTaskConversationProvider component={Button} loadSharedTaskIds={load}>
    <RequesterSharedTasksProvider ids={shared ? new Set(shared) : null}><RequesterTaskConversation projectId="p" taskId="t" /></RequesterSharedTasksProvider>
  </RequesterTaskConversationProvider>;
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
  it('is absent with FORCE_CAPABILITIES=co-managed:off', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCE_CAPABILITIES', 'co-managed:off');
    view(undefined);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    // The server bootstrap already reflects its own force: a forced-off capability is bootstrapped closed.
    view({ 'capability:co-managed': false, 'capability:co-managed:admit': false });
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent when served but the shared-work answer is unknown or excludes the task', () => {
    view(served, null);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    view(served, ['other']);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent for a PSA sponsor: admitted, but its native non-shared project has no shared tasks', () => {
    view({ 'capability:co-managed': true, 'capability:co-managed:admit': true }, []);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is absent when serving but the application supplied no implementation', () => {
    render(<FeatureFlagBootstrapProvider initialFeatureFlags={served}><RequesterSharedTasksProvider ids={new Set(['t'])}><RequesterTaskConversation projectId="p" taskId="t" /></RequesterSharedTasksProvider></FeatureFlagBootstrapProvider>);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is present for a customer requester: served, not admitted, task is shared work', () => {
    view(served);
    expect(screen.getByRole('button', { name: 'Conversation' })).toBeTruthy();
  });
});
