import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

function readRepoSource(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, '../../../../..', relativePath), 'utf8');
}

describe('default contact email consumer compatibility contracts', () => {
  it('T046: portal invitation, registration, and client-user recovery flows stay anchored on contacts.email', () => {
    const portalInvitationSource = readRepoSource('packages/portal-shared/src/actions/portalInvitationActions.ts');
    const registrationHelpersSource = readRepoSource('packages/auth/src/lib/registrationHelpers.ts');
    const registrationActionsSource = readRepoSource('packages/users/src/actions/user-actions/registrationActions.ts');
    const tenantRecoverySource = readRepoSource('packages/client-portal/src/actions/portal-actions/tenantRecoveryActions.ts');

    expect(portalInvitationSource).toContain('email: contact.email');
    expect(portalInvitationSource).toContain("username: contact.email.toLowerCase()");
    expect(registrationHelpersSource).toContain("'contacts.email': email.toLowerCase()");
    expect(registrationHelpersSource).toContain(".where('contacts.email', email)");
    expect(registrationActionsSource).toContain(".where('contacts.email', email)");
    expect(tenantRecoverySource).toContain("'contacts.email': email.toLowerCase()");
  });

  it('T047: ticket, project, survey, billing, and scheduling sends still use the default contact email field', () => {
    const surveyServiceSource = readRepoSource('server/src/services/surveyService.ts');
    const invoiceJobActionsSource = readRepoSource('packages/billing/src/actions/invoiceJobActions.ts');
    const invoiceEmailHandlerSource = readRepoSource('server/src/lib/jobs/handlers/invoiceEmailHandler.ts');
    const appointmentRequestActionsSource = readRepoSource('packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts');
    const projectEmailSubscriberSource = readRepoSource('server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts');
    const ticketEmailSubscriberSource = readRepoSource('server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts');

    expect(surveyServiceSource).toContain('to: contact.email,');
    expect(invoiceJobActionsSource).toContain('recipientEmail = contact.email;');
    expect(invoiceEmailHandlerSource).toContain('recipientEmail = contact.email || recipientEmail;');
    expect(appointmentRequestActionsSource).toContain("requesterEmail: contact.email || currentUser.email || ''");
    expect(projectEmailSubscriberSource).toContain("'ct.email as contact_email'");
    expect(projectEmailSubscriberSource).toContain('to: project.contact_email,');
    expect(ticketEmailSubscriberSource).toContain("'co.email as contact_email'");
    expect(ticketEmailSubscriberSource).toContain('const primaryEmail = safeString(ticket.contact_email) || safeString(ticket.client_email);');
  });
});
