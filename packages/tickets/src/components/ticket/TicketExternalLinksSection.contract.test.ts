// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('ticket external links UI contract', () => {
  it('T120: the section is mounted in both ticket layouts', () => {
    const entry = readRepoFile('packages/tickets/src/components/ticket/TicketDetails.tsx');
    const bento = readRepoFile('packages/tickets/src/components/ticket/bento/TicketBentoLayout.tsx');

    expect(entry).toContain('<TicketExternalLinksSection');
    expect(entry).toContain('initialLinks={bootstrap?.externalLinks');
    expect(bento).toContain('<TicketExternalLinksSection');
    expect(bento).toContain('initialLinks={props.externalLinks}');
  });

  it('T121: the add/edit dialog disables origin when one already exists', () => {
    const source = readRepoFile('packages/tickets/src/components/ticket/TicketExternalLinksSection.tsx');

    expect(source).toContain("relationship === 'origin' && hasOrigin && form.relationship !== 'origin'");
    expect(source).toContain('originExistsHint');
    expect(source).toContain('renderExternalLinkUrl');
    expect(source).toContain("externalLinks.errors.urlRequired");
  });

  it('T121b: client components import the server-action module directly, never the barrel', () => {
    // The barrel re-exports externalLinkErrors, which imports the persistence
    // module and @alga-psa/db. Importing it from a client component drags
    // server-only knex/fs/module into the browser bundle and breaks the ticket
    // page under Turbopack. Client components must import the 'use server'
    // module (or a type-only path) instead.
    const section = readRepoFile('packages/tickets/src/components/ticket/TicketExternalLinksSection.tsx');
    const bento = readRepoFile('packages/tickets/src/components/ticket/bento/TicketBentoLayout.tsx');

    expect(section).toContain("from '../../actions/externalLinks/externalLinkActions'");
    expect(section).not.toMatch(/from '\.\.\/\.\.\/actions\/externalLinks';/);
    expect(bento).not.toMatch(/from '\.\.\/\.\.\/\.\.\/actions\/externalLinks';/);
  });

  it('T122: link-out is opened safely in a new tab', () => {
    const source = readRepoFile('packages/tickets/src/components/ticket/TicketExternalLinksSection.tsx');
    const commentItem = readRepoFile('packages/tickets/src/components/ticket/CommentItem.tsx');

    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(commentItem).toContain('externalLinks');
    expect(commentItem).toContain('target="_blank"');
  });

  it('T123: links load through ticket bootstrap and comment links flow to the conversation', () => {
    const page = readRepoFile('server/src/app/msp/tickets/[id]/page.tsx');
    const details = readRepoFile('packages/tickets/src/components/ticket/TicketDetails.tsx');

    expect(page).toContain('getTicketExternalLinks(id)');
    expect(page).toContain('externalLinks');
    expect(details).toContain('externalLinksByCommentId');
    expect(details).toContain('externalLinksByCommentId={externalLinksByCommentId}');
  });

  it('T124: the client portal never selects or renders external links', () => {
    const portalDetails = readRepoFile('packages/client-portal/src/components/tickets/TicketDetails.tsx');
    const portalActions = readRepoFile('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    expect(portalDetails).not.toContain('externalLinks');
    expect(portalDetails).not.toContain('external_links');
    expect(portalActions).not.toContain('external_entity_links');
    expect(portalActions).not.toContain('external_links');
  });

  it('T125: the External systems settings tab is registered', () => {
    const settings = readRepoFile('server/src/components/settings/general/TicketingSettings.tsx');

    expect(settings).toContain("'external-systems'");
    expect(settings).toContain('ExternalSystemsSettings');
    expect(settings).toContain("ticketing.tabs.externalSystems");
  });
});
