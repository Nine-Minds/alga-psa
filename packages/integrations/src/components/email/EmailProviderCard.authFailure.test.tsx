/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmailProvider } from './types';
import { EmailProviderCard } from './EmailProviderCard';

function buildProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    id: 'provider-1',
    tenant: 'tenant-1',
    providerType: 'microsoft',
    providerName: 'Support Mailbox',
    mailbox: 'support@contoso.example',
    isActive: true,
    inboundPausedAt: new Date('2026-08-15T10:00:00Z').toISOString(),
    inboundPauseReason: 'auth_failure',
    status: 'error',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-15T10:00:00Z',
    ...overrides,
  };
}

function renderCard(provider: EmailProvider, onReconnect = vi.fn()) {
  const handlers = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onTestConnection: vi.fn(),
    onRefreshWatchSubscription: vi.fn(),
    onRetryRenewal: vi.fn(),
    onRunDiagnostics: vi.fn(),
    onChangeDefaults: vi.fn(),
    onTogglePause: vi.fn(),
    onReconnect,
  };
  render(
    <EmailProviderCard
      provider={provider}
      defaultsOptions={[]}
      updatingProviderId={null}
      {...handlers}
    />
  );
  return handlers;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function menuTrigger(): HTMLElement {
  const trigger = screen.getAllByRole('button').find((button) =>
    button.getAttribute('aria-haspopup') === 'menu'
  );
  expect(trigger).toBeDefined();
  return trigger!;
}

async function openMenu() {
  const trigger = menuTrigger();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: /Edit Configuration/i })).toBeInTheDocument();
  });
  return screen.getByRole('menu');
}

describe('EmailProviderCard auth_failure pause (UI)', () => {
  beforeAll(() => {
    // Radix dropdown interaction helpers missing in jsdom.
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false) as any;
    HTMLElement.prototype.releasePointerCapture = vi.fn() as any;
    HTMLElement.prototype.scrollIntoView = vi.fn() as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the destructive reconnect banner for auth_failure pauses', () => {
    renderCard(buildProvider());

    const banner = byId('provider-auth-failure-banner-provider-1');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('class')).toMatch(/destructive/i);

    // The banner names the mailbox and explains the failure; the neutral
    // paused help is reserved for manual pauses.
    expect(banner!.textContent).toContain('support@contoso.example');
    expect(banner!.textContent).toMatch(/credentials no longer work/i);
    expect(banner!.textContent).toMatch(/remain in the source mailbox/i);
    expect(byId('provider-paused-help-provider-1')).toBeNull();

    expect(byId('provider-paused-badge-provider-1')).not.toBeNull();
    expect(byId('provider-auth-failure-title-provider-1')).not.toBeNull();
  });

  it('dispatches the threaded reconnect callback from the banner button', () => {
    const onReconnect = vi.fn();
    const handlers = renderCard(buildProvider(), onReconnect);

    const button = within(byId('provider-auth-failure-banner-provider-1')!).getByRole('button');
    fireEvent.click(button);

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-1' }));
    // The reconnect action never doubles as a bare resume.
    expect(handlers.onTogglePause).not.toHaveBeenCalled();
  });

  it('does not offer a bare Resume action for auth_failure pauses', async () => {
    renderCard(buildProvider());

    const menu = await openMenu();

    const menuItems = within(menu).getAllByRole('menuitem');
    const itemTexts = menuItems.map((item) => item.textContent || '');
    expect(itemTexts.some((text) => text.includes('providerCard.actions.resume'))).toBe(false);
    expect(itemTexts.some((text) => text.includes('providerCard.actions.pause'))).toBe(false);
  });

  it('keeps the neutral paused help and Resume action for manual pauses', async () => {
    renderCard(buildProvider({ inboundPauseReason: 'manual', status: 'connected' }));

    expect(byId('provider-auth-failure-banner-provider-1')).toBeNull();
    expect(byId('provider-paused-help-provider-1')).not.toBeNull();

    const menu = await openMenu();
    const menuItems = within(menu).getAllByRole('menuitem');
    const itemTexts = menuItems.map((item) => item.textContent || '');
    expect(itemTexts.some((text) => text.includes('providerCard.actions.resume'))).toBe(true);
  });
});
