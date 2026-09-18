/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  CallLink,
  CallLinkProvider,
  TeamsCallLink,
  buildTeamsCallDeepLink,
  buildTelHref,
} from './CallLink';

describe('T045/T046 click-to-call', () => {
  it('builds tel: hrefs from formatted numbers and refuses empty input', () => {
    expect(buildTelHref('+1 (555) 123-4567')).toBe('tel:+15551234567');
    expect(buildTelHref('555.123.4567')).toBe('tel:5551234567');
    expect(buildTelHref('')).toBeNull();
    expect(buildTelHref(null)).toBeNull();
  });

  it('builds a Teams PSTN deep link', () => {
    expect(buildTeamsCallDeepLink('+15551234567')).toBe(
      'https://teams.microsoft.com/l/call/0/0?users=4:%2B15551234567',
    );
  });

  it('renders a tel: link and no Teams link by default', () => {
    render(<CallLink id="contact-phone-1" phoneNumber="+15551234567" />);
    expect(screen.getByText('+15551234567').getAttribute('href')).toBe('tel:+15551234567');
    expect(document.getElementById('contact-phone-1-teams')).toBeNull();
    cleanup();
  });

  it('adds the Teams call link with the custom tooltip only when Teams is active for the tenant', async () => {
    render(
      <CallLinkProvider teamsCallEnabled>
        <CallLink id="contact-phone-2" phoneNumber="+15551234567" />
      </CallLinkProvider>,
    );
    expect(document.getElementById('contact-phone-2-teams')?.getAttribute('href')).toContain(
      'teams.microsoft.com/l/call',
    );
    // The custom tooltip replaces the browser-native title while the accessible
    // name remains available to assistive technology.
    expect(document.getElementById('contact-phone-2-teams')?.getAttribute('title')).toBeNull();
    expect(document.getElementById('contact-phone-2-teams')?.getAttribute('aria-label')).toBe(
      'Call in Microsoft Teams',
    );
    fireEvent.focus(document.getElementById('contact-phone-2-teams')!);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Call in Microsoft Teams');
    cleanup();
  });

  it('shows the labelled Call action only when Teams Phone is connected', () => {
    const { rerender } = render(
      <CallLinkProvider teamsCallEnabled teamsPhoneConnected={false}>
        <TeamsCallLink id="ticket-call" phoneNumber="+15551234567">Call</TeamsCallLink>
      </CallLinkProvider>,
    );
    expect(document.getElementById('ticket-call')).toBeNull();

    rerender(
      <CallLinkProvider teamsCallEnabled teamsPhoneConnected>
        <TeamsCallLink id="ticket-call" phoneNumber="+15551234567">Call</TeamsCallLink>
      </CallLinkProvider>,
    );
    expect(screen.getByText('Call').getAttribute('href')).toContain('teams.microsoft.com/l/call');
    cleanup();
  });

  it('records the ticket call intent while allowing the Teams link to open', () => {
    const recordCallIntent = vi.fn();
    render(
      <CallLinkProvider teamsCallEnabled teamsPhoneConnected recordCallIntent={recordCallIntent}>
        <TeamsCallLink
          id="ticket-call-intent"
          phoneNumber="+15551234567"
          callIntent={{ ticketId: 'ticket-1' }}
        >
          Call
        </TeamsCallLink>
      </CallLinkProvider>,
    );

    fireEvent.click(screen.getByText('Call'));

    expect(recordCallIntent).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      phoneNumber: '+15551234567',
    });
    cleanup();
  });
});
