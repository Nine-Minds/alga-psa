/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Layout from '../../../app/msp/co-management/customer-tickets/layout';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn(async () => ({ user: { tenant: 'tenant-1' } })) }));
const gate = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: gate }));
vi.mock('../../../app/msp/_components/WorkspaceRouteLayout', () => ({ default: ({ children }: any) => <div data-testid="workspace-route">{children}</div> }));

describe('co-managed customer tickets layout', () => {
  it('wraps the shared ticket in the workspace providers the ticket screen needs', async () => {
    render(await Layout({ children: <span>shared ticket</span> }));
    expect(gate).toHaveBeenCalledWith('co-managed', 'tenant-1', 'serves');
    expect(screen.getByTestId('workspace-route')).toContainElement(screen.getByText('shared ticket'));
  });
});
