/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CallLink, CallLinkProvider, buildTeamsCallDeepLink, buildTelHref } from './CallLink';

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

  it('adds the Teams call link only when Teams is active for the tenant', () => {
    render(
      <CallLinkProvider teamsCallEnabled>
        <CallLink id="contact-phone-2" phoneNumber="+15551234567" />
      </CallLinkProvider>,
    );
    expect(document.getElementById('contact-phone-2-teams')?.getAttribute('href')).toContain(
      'teams.microsoft.com/l/call',
    );
    cleanup();
  });
});
