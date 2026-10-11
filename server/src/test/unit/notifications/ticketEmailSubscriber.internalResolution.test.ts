import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ticketEmailSubscriberTestHarness } from '../../../lib/eventBus/subscribers/ticketEmailSubscriber';

const { resolveCloseEmailResolutions } = ticketEmailSubscriberTestHarness;

function blockNote(text: string): string {
  return JSON.stringify([
    {
      type: 'paragraph',
      props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
      content: [{ type: 'text', text, styles: {} }],
    },
  ]);
}

const INTERNAL_BODY = 'Root cause: the client never patched the firewall.';
const CLIENT_BODY = 'Replaced the failed switch and verified connectivity.';

describe('ticket closed email resolution visibility', () => {
  it('keeps an internal resolution out of the external body', () => {
    const internalResolution = { note: blockNote(INTERNAL_BODY), is_internal: true };

    const { internalResolutionHtml, externalResolutionHtml } = resolveCloseEmailResolutions(
      internalResolution,
      undefined,
    );

    expect(internalResolutionHtml).toContain(INTERNAL_BODY);
    expect(externalResolutionHtml).toBe('');
  });

  it('gives both recipient classes the same body when the latest resolution is client-visible', () => {
    const resolution = { note: blockNote(CLIENT_BODY), is_internal: false };

    const { internalResolutionHtml, externalResolutionHtml } = resolveCloseEmailResolutions(
      resolution,
      resolution,
    );

    expect(internalResolutionHtml).toContain(CLIENT_BODY);
    expect(externalResolutionHtml).toContain(CLIENT_BODY);
  });

  it('falls back to the latest client-visible resolution behind an internal one', () => {
    const { internalResolutionHtml, externalResolutionHtml } = resolveCloseEmailResolutions(
      { note: blockNote(INTERNAL_BODY), is_internal: true },
      { note: blockNote(CLIENT_BODY), is_internal: false },
    );

    expect(internalResolutionHtml).toContain(INTERNAL_BODY);
    expect(internalResolutionHtml).not.toContain(CLIENT_BODY);
    expect(externalResolutionHtml).toContain(CLIENT_BODY);
    expect(externalResolutionHtml).not.toContain(INTERNAL_BODY);
  });

  it('still blanks the external body if an internal row reaches the client-visible slot', () => {
    const internalResolution = { note: blockNote(INTERNAL_BODY), is_internal: true };

    const { externalResolutionHtml } = resolveCloseEmailResolutions(
      internalResolution,
      internalResolution,
    );

    expect(externalResolutionHtml).toBe('');
  });

  it('yields empty bodies when the ticket has no resolution comment', () => {
    expect(resolveCloseEmailResolutions(null, null)).toEqual({
      internalResolutionHtml: '',
      externalResolutionHtml: '',
    });
  });

  it('wires the split bodies into the close email contexts', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts'),
      'utf8',
    );

    // Contact, bundle child requester and external watcher mails all spread
    // baseTicketContext, so the client-safe body has to be the default.
    expect(source).toContain('resolution: externalResolutionHtml');
    expect(source).toContain('resolution: internalResolutionHtml');
    expect(source).toContain("await resolutionCommentQuery().where('is_internal', false).first()");
  });
});
