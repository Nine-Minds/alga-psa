import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyEmbeddedImageUrlMappingsToStoredBodies,
  blocksFromEmailBody,
  preserveEmbeddedImageUrlBlocks,
  rewriteEmbeddedImageSourcesInContent,
} from '../inboundEmbeddedImageUrlRewrite';
import type { EmbeddedImageUrlMapping } from '../processInboundEmailArtifacts';

const withTenantAdminTransactionMock = vi.fn();

vi.mock('../tenantAdminTransaction', () => ({
  withTenantAdminTransaction: (...args: any[]) => withTenantAdminTransactionMock(...args),
}));

interface FakeDb {
  table: (name: string) => any;
  comments: Map<string, string>;
  tickets: Map<string, string>;
}

function createFakeDb(): FakeDb {
  const comments = new Map<string, string>();
  const tickets = new Map<string, string>();

  const table = (name: string) => ({
    where: (clause: Record<string, string>) => ({
      first: async (column: string) => {
        if (name === 'comments') {
          const note = comments.get(clause.comment_id);
          return note === undefined ? undefined : { [column]: note };
        }
        if (name === 'tickets') {
          const attributes = tickets.get(clause.ticket_id);
          return attributes === undefined ? undefined : { [column]: attributes };
        }
        return undefined;
      },
      update: async (patch: Record<string, string>) => {
        if (name === 'comments') {
          comments.set(clause.comment_id, patch.note);
          return 1;
        }
        if (name === 'tickets') {
          tickets.set(clause.ticket_id, patch.attributes);
          return 1;
        }
        return 0;
      },
    }),
  });

  return { table, comments, tickets };
}

const CID_HTML = '<p>Hello</p><img src="cid:smoke-logo" alt="Smoke logo" />';
const CID_MAPPINGS: EmbeddedImageUrlMapping[] = [
  {
    source: 'cid',
    reference: 'smoke-logo',
    fileId: 'file-1',
    documentId: 'doc-1',
    url: '/api/documents/view/file-1',
  },
];

async function cidBody(): Promise<string> {
  return JSON.stringify(await blocksFromEmailBody({ html: CID_HTML }));
}

describe('inboundEmbeddedImageUrlRewrite', () => {
  let db: FakeDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createFakeDb();
    withTenantAdminTransactionMock.mockImplementation(
      async (_tenantId: string, callback: (trx: any, db: any) => Promise<any>) =>
        callback({}, db)
    );
  });

  it('rewrites cid sources in a content string in place', () => {
    const body = '[{"type":"image","props":{"url":"cid:smoke-logo"}}]';
    const rewritten = rewriteEmbeddedImageSourcesInContent(body, CID_MAPPINGS);
    expect(rewritten).toContain('/api/documents/view/file-1');
    expect(rewritten).not.toContain('cid:smoke-logo');
  });

  it('does not append a second image block when the served URL is already present', async () => {
    const body = await cidBody();
    const alreadyResolved = rewriteEmbeddedImageSourcesInContent(body, CID_MAPPINGS);
    const blocks = JSON.parse(alreadyResolved);

    const preserved = preserveEmbeddedImageUrlBlocks(blocks, CID_MAPPINGS);
    expect(JSON.stringify(preserved)).toBe(alreadyResolved);
    expect(
      (preserved as any[]).filter((block) => block?.props?.url === '/api/documents/view/file-1')
    ).toHaveLength(1);
  });

  it('appends one image block when the mapping URL is genuinely absent', () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', styles: {} }] }];
    const preserved = preserveEmbeddedImageUrlBlocks(blocks, CID_MAPPINGS) as any[];
    expect(preserved).toHaveLength(2);
    expect(preserved[1].props.url).toBe('/api/documents/view/file-1');
  });

  it('is idempotent: applying twice writes once and never duplicates the image block', async () => {
    const original = await cidBody();
    db.comments.set('comment-1', original);

    const args = {
      tenantId: 'tenant-1',
      html: CID_HTML,
      text: 'Hello',
      mappings: CID_MAPPINGS,
      targets: [{ kind: 'comment' as const, id: 'comment-1', originalContent: original }],
    };

    await applyEmbeddedImageUrlMappingsToStoredBodies(args);
    const afterFirst = db.comments.get('comment-1');
    expect(afterFirst).toContain('/api/documents/view/file-1');
    expect(afterFirst).not.toContain('cid:smoke-logo');

    const writesAfterFirst = withTenantAdminTransactionMock.mock.calls.length;
    await applyEmbeddedImageUrlMappingsToStoredBodies(args);
    expect(db.comments.get('comment-1')).toBe(afterFirst);
    expect(withTenantAdminTransactionMock.mock.calls.length).toBe(writesAfterFirst + 1);
    expect(
      JSON.parse(afterFirst!).filter((block: any) => block?.props?.url === '/api/documents/view/file-1')
    ).toHaveLength(1);
  });

  it('leaves human-edited content alone once no unresolved cid remains', async () => {
    const edited = '[{"type":"paragraph","content":[{"type":"text","text":"human edited","styles":{}}]}]';
    db.comments.set('comment-1', edited);

    await applyEmbeddedImageUrlMappingsToStoredBodies({
      tenantId: 'tenant-1',
      html: CID_HTML,
      mappings: CID_MAPPINGS,
      targets: [{ kind: 'comment', id: 'comment-1', originalContent: await cidBody() }],
    });

    expect(db.comments.get('comment-1')).toBe(edited);
  });

  it('rewrites only the src in place when edited content still carries a cid', async () => {
    const edited = '[{"type":"paragraph","content":[{"type":"text","text":"human edited","styles":{}}]},{"type":"image","props":{"url":"cid:smoke-logo"}}]';
    db.comments.set('comment-1', edited);

    await applyEmbeddedImageUrlMappingsToStoredBodies({
      tenantId: 'tenant-1',
      html: CID_HTML,
      mappings: CID_MAPPINGS,
      targets: [{ kind: 'comment', id: 'comment-1', originalContent: await cidBody() }],
    });

    const stored = db.comments.get('comment-1')!;
    expect(stored).toContain('human edited');
    expect(stored).toContain('/api/documents/view/file-1');
    expect(stored).not.toContain('cid:smoke-logo');
    expect(JSON.parse(stored)).toHaveLength(2);
  });

  it('rewrites the description and originating comment for a created outcome', async () => {
    const original = await cidBody();
    db.comments.set('comment-1', original);
    db.tickets.set('ticket-1', JSON.stringify({ watch_list: [], description: original }));

    await applyEmbeddedImageUrlMappingsToStoredBodies({
      tenantId: 'tenant-1',
      html: CID_HTML,
      mappings: CID_MAPPINGS,
      targets: [
        { kind: 'comment', id: 'comment-1', originalContent: original },
        { kind: 'ticket-description', id: 'ticket-1', originalContent: original },
      ],
    });

    expect(db.comments.get('comment-1')).toContain('/api/documents/view/file-1');
    const attributes = JSON.parse(db.tickets.get('ticket-1')!);
    expect(attributes.description).toContain('/api/documents/view/file-1');
    expect(attributes.watch_list).toEqual([]);
  });

  it('touches only the comment when the outcome is replied (no description target)', async () => {
    const original = await cidBody();
    db.comments.set('comment-1', original);
    db.tickets.set('ticket-1', JSON.stringify({ description: original }));

    await applyEmbeddedImageUrlMappingsToStoredBodies({
      tenantId: 'tenant-1',
      html: CID_HTML,
      mappings: CID_MAPPINGS,
      targets: [{ kind: 'comment', id: 'comment-1', originalContent: original }],
    });

    expect(db.comments.get('comment-1')).toContain('/api/documents/view/file-1');
    const attributes = JSON.parse(db.tickets.get('ticket-1')!);
    expect(attributes.description).toContain('cid:smoke-logo');
  });
});
