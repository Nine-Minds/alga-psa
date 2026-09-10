// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  workspaceProps: null as Record<string, any> | null,
}));

function MspInteractionsWorkspaceMock(props: Record<string, any>) {
  mocks.workspaceProps = props;
  return <div data-testid="interactions-page-workspace" />;
}

function UserDetailsMock() {
  return null;
}

vi.mock('@alga-psa/msp-composition/clients/MspInteractionsWorkspace', () => ({
  default: MspInteractionsWorkspaceMock,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

vi.mock('@/components/settings/general/UserDetails', () => ({
  default: UserDetailsMock,
}));

import InteractionsPageWorkspace from 'server/src/app/msp/interactions/InteractionsPageWorkspace';

describe('InteractionsPageWorkspace', () => {
  afterEach(() => {
    cleanup();
    mocks.openDrawer.mockReset();
    mocks.workspaceProps = null;
  });

  it('bridges interaction user links to the full user details drawer', () => {
    const onUpdate = vi.fn();
    render(
      <InteractionsPageWorkspace
        users={[]}
        contacts={[]}
        clients={[]}
        telephonyOverview={null}
      />,
    );

    expect(screen.getByTestId('interactions-page-workspace')).toBeTruthy();
    act(() => mocks.workspaceProps?.onOpenUser('user-1', onUpdate));

    expect(mocks.openDrawer).toHaveBeenCalledTimes(1);
    const drawerContent = mocks.openDrawer.mock.calls[0][0] as React.ReactElement;
    expect(drawerContent.type).toBe(UserDetailsMock);
    expect(drawerContent.props).toMatchObject({ userId: 'user-1', onUpdate });
  });
});
