import { describe, expect, it } from 'vitest';
import { resolveClientPortalTitleKey } from './clientPortalRouteTitles';

describe('resolveClientPortalTitleKey', () => {
  it('returns null for nullish or empty paths', () => {
    expect(resolveClientPortalTitleKey(null)).toBeNull();
    expect(resolveClientPortalTitleKey(undefined)).toBeNull();
    expect(resolveClientPortalTitleKey('')).toBeNull();
  });

  it('maps the dashboard root paths', () => {
    expect(resolveClientPortalTitleKey('/client-portal')).toBe('nav.dashboard');
    expect(resolveClientPortalTitleKey('/client-portal/dashboard')).toBe('nav.dashboard');
  });

  it('maps the new top-level routes', () => {
    expect(resolveClientPortalTitleKey('/client-portal/devices')).toBe('nav.myDevices');
    expect(resolveClientPortalTitleKey('/client-portal/appointments')).toBe('nav.appointments');
    expect(resolveClientPortalTitleKey('/client-portal/projects')).toBe('nav.projects');
    expect(resolveClientPortalTitleKey('/client-portal/tickets')).toBe('nav.tickets');
    expect(resolveClientPortalTitleKey('/client-portal/request-services')).toBe('nav.requestServices');
    expect(resolveClientPortalTitleKey('/client-portal/documents')).toBe('nav.documents');
    expect(resolveClientPortalTitleKey('/client-portal/knowledge-base')).toBe('nav.knowledgeBase');
    expect(resolveClientPortalTitleKey('/client-portal/billing')).toBe('nav.billing');
    expect(resolveClientPortalTitleKey('/client-portal/client-settings')).toBe('nav.clientSettings');
    expect(resolveClientPortalTitleKey('/client-portal/profile')).toBe('nav.profile');
    expect(resolveClientPortalTitleKey('/client-portal/account')).toBe('nav.account');
  });

  it('matches nested subroutes via prefix', () => {
    expect(resolveClientPortalTitleKey('/client-portal/devices/abc123')).toBe('nav.myDevices');
    expect(resolveClientPortalTitleKey('/client-portal/appointments/xyz/details')).toBe('nav.appointments');
    expect(resolveClientPortalTitleKey('/client-portal/billing/invoices/42')).toBe('nav.billing');
  });

  it('returns null for unknown paths', () => {
    expect(resolveClientPortalTitleKey('/client-portal/totally-new-area')).toBeNull();
    expect(resolveClientPortalTitleKey('/somewhere-else')).toBeNull();
  });
});
