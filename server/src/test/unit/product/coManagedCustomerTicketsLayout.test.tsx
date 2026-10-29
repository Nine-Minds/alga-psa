/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Layout from '../../../app/msp/co-management/customer-tickets/layout';

vi.mock('../../../app/msp/_components/WorkspaceRouteLayout', () => ({ default: ({ children }: any) => <div data-testid="workspace-route">{children}</div> }));

describe('co-managed customer tickets layout', () => {
  it('wraps the shared ticket in the workspace providers the ticket screen needs', () => {
    render(<Layout><span>shared ticket</span></Layout>);
    expect(screen.getByTestId('workspace-route')).toContainElement(screen.getByText('shared ticket'));
  });
});
