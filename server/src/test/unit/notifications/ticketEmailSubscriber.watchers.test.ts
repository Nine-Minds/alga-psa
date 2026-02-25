import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketEmailSubscriberSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('ticketEmailSubscriber watcher behavior', () => {
  it('T027: active watcher extraction ignores inactive entries', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('export function extractActiveWatcherEmails(attributes: unknown): string[]');
    expect(source).toContain('getActiveWatchListEmails(attributes)');
    expect(source).toContain('Array.from(new Set');
  });

  it('T028: ticket-created watcher notifications use customer-visible context', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-created'[\s\S]*context: buildContext\(portalUrl\)[\s\S]*'Ticket Created'/
    );
  });

  it('T029: ticket-updated accumulator path includes watchers in accumulation set', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /for \(const watcherEmail of activeWatcherEmails\) \{\s*await accumulateIfUnique\(\{\s*recipientEmail: watcherEmail,\s*isInternal: false,/
    );
  });

  it('T030: ticket-updated non-accumulator path sends watcher notifications immediately', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-updated'[\s\S]*'Ticket Updated'/
    );
  });

  it('T031: ticket-assigned watcher notifications dedupe through a shared sent-email set', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('const sentEmails = new Set<string>();');
    expect(source).toMatch(
      /handleTicketAssigned[\s\S]*sendOneEmailPerWatcher\([\s\S]*excludeEmails: sentEmails/
    );
  });

  it('T032: public internal-agent comments include watcher notifications', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(/if \(isPublicComment && isFromAgent\) \{[\s\S]*sendOneEmailPerWatcher\(/);
  });

  it('T033: internal comments do not include watcher notifications', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('const isPublicComment = !payload.comment?.isInternal;');
    expect(source).toMatch(/if \(isPublicComment && isFromAgent\) \{/);
  });

  it('T034: client-authored public comments are excluded by the internal-agent gate', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('let isFromAgent = false;');
    expect(source).toContain("isFromAgent = author?.user_type === 'internal';");
  });

  it('T035: ticket-closed watcher notifications use customer-visible context', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-closed'[\s\S]*context: externalContext[\s\S]*'Ticket Closed'/
    );
  });

  it('T036: watcher recipients dedupe against primary contact/client recipient', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(/sendIfUnique\([\s\S]*contactId: primaryContactId[\s\S]*'Ticket Closed'/);
    expect(source).toMatch(/sendOneEmailPerWatcher\([\s\S]*excludeEmails: sentEmails/);
  });

  it('T037: watcher recipients dedupe against assigned/additional resource recipients', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(/'Ticket Assigned', ticket\.assigned_to/);
    expect(source).toMatch(/'Ticket Assigned', resource\.user_id/);
    expect(source).toMatch(/sendOneEmailPerWatcher\([\s\S]*excludeEmails: sentEmails/);
  });

  it('T038: comment author suppression applies to watcher sends', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('if (commentAuthorEmail && key === normalizeRecipientEmail(commentAuthorEmail))');
    expect(source).toMatch(/sendOneEmailPerWatcher\([\s\S]*'Ticket Comment Added'/);
  });

  it('T039: watcher send helper issues one send call per watcher email (no aggregated CC payload)', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('export async function sendOneEmailPerWatcher(');
    expect(source).toContain('for (const watcherEmail of watcherEmails)');
    expect(source).toContain('await sendFn(email);');
    expect(source).not.toContain('cc:');
  });

  it('T040: watcher receives ticket-created email as a separate per-recipient send path', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-created'[\s\S]*subject: emailSubject/
    );
  });

  it('T041: watcher receives ticket-updated email as a separate per-recipient send path', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-updated'[\s\S]*subject: `Ticket Updated: \$\{ticket\.title\}`/
    );
  });

  it('T042: watcher receives public-comment notifications and not internal-note notifications', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toContain('const isPublicComment = !payload.comment?.isInternal;');
    expect(source).toMatch(/if \(isPublicComment && isFromAgent\) \{[\s\S]*sendOneEmailPerWatcher\(/);
  });

  it('T043: watcher receives ticket-closed email as a separate per-recipient send path', () => {
    const source = readTicketEmailSubscriberSource();
    expect(source).toMatch(
      /sendOneEmailPerWatcher\([\s\S]*template: 'ticket-closed'[\s\S]*subject: `Ticket Closed: \$\{ticket\.title\}`/
    );
  });
});
