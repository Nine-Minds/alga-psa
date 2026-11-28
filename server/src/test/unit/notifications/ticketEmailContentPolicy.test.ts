import { describe, expect, it } from 'vitest';
import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';
import {
  redactTicketEmailRenderedContent,
  redactTicketEmailStructuredContent,
} from '../../../lib/notifications/ticketEmailContentPolicy';

const mixed = {
  allowInlineImages: false,
  suppressProtectedContent: true,
  missingImageText: '[Image not included]',
  protectedContentText: '[Protected content not included]',
};

describe('ticket email content audience policy', () => {
  it('redacts ProseMirror images, media and protected link marks but keeps ordinary links', () => {
    const doc = {
      type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'Public details ' },
          { type: 'text', text: 'Private document', marks: [
            { type: 'link', attrs: { href: '/api/documents/download/document-1' } },
          ] },
          { type: 'text', text: ' Help', marks: [
            { type: 'link', attrs: { href: 'https://example.test/help' } },
          ] },
        ] },
        { type: 'image', attrs: { src: 'data:image/png;base64,YQ==' } },
        { type: 'video', attrs: { src: 'https://media.example.test/private' } },
      ],
    };
    const result = redactTicketEmailStructuredContent(doc, mixed);
    const rendered = formatBlockNoteContent(result.content);

    expect(result.redacted).toBe(true);
    expect(JSON.stringify(result.content)).not.toMatch(/data:image|\/api\/documents|media\.example/);
    expect(rendered.html).toContain('Public details');
    expect(rendered.html).toContain('https://example.test/help');
    expect(rendered.html).toContain('[Image not included]');
    expect(rendered.html).toContain('[Protected content not included]');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('Private document');
  });

  it('cleans legacy HTML, plain URLs and markdown without stripping normal links', async () => {
    const html = '<p>Keep <a href="https://example.test/help">Help</a> ' +
      '<a href="https://alga.test/api/documents/download/doc-1">Private</a> ' +
      '<img src="https://example.test/image.png"></p>';
    const text = 'Keep ![image](https://example.test/a_(1).png) [Help](https://example.test/help) ' +
      '[Private](/api/documents/download/doc-1) data:image/png;base64,YQ==';
    const safeHtml = await redactTicketEmailRenderedContent(html, 'html', mixed);
    const safeText = await redactTicketEmailRenderedContent(text, 'text', mixed);

    expect(safeHtml.redacted).toBe(true);
    expect(safeHtml.value).toContain('href="https://example.test/help"');
    expect(safeHtml.value).toContain('[Protected content not included]');
    expect(safeHtml.value).not.toMatch(/<img|\/api\/documents|image\.png/);
    expect(safeText.value).toContain('[Help](https://example.test/help)');
    expect(safeText.value).toContain('[Image not included]');
    expect(safeText.value).toContain('[Protected content not included]');
    expect(safeText.value).not.toMatch(/a_\(1\)\.png|\/api\/documents|data:image/);
  });

  it('redacts explicitly denied file or document IDs even for an internal message', async () => {
    const policy = {
      ...mixed, allowInlineImages: true, suppressProtectedContent: false,
      deniedDocumentIds: new Set(['document-1']),
    };
    const result = await redactTicketEmailRenderedContent(
      'Details [private](/api/documents/download/document-1) [help](https://example.test/help)', 'text', policy,
    );
    expect(result.value).toContain('[Protected content not included]');
    expect(result.value).toContain('[help](https://example.test/help)');
    expect(result.value).not.toContain('document-1');
  });

  it('recognizes encoded protected paths in structured links, rendered links, and plain URLs', async () => {
    const content = [{
      type: 'paragraph',
      content: [
        { type: 'link', href: '/api/%64ocuments/download/document-1',
          content: [{ type: 'text', text: 'Private', styles: {} }] },
        { type: 'link', href: 'https://example.test/help',
          content: [{ type: 'text', text: 'Help', styles: {} }] },
      ],
    }];
    const structured = redactTicketEmailStructuredContent(content, mixed);
    const html = await redactTicketEmailRenderedContent(
      '<a href="/api/%64ocuments/download/document-1">Private</a> ' +
      '<a href="https://example.test/help">Help</a>', 'html', mixed,
    );
    const text = await redactTicketEmailRenderedContent(
      'Private /api%2Fdocuments%2Fview%2Ffile-1 and /api/%74icket-comment-attachments/download?token=secret',
      'text', mixed,
    );
    const denied = await redactTicketEmailRenderedContent(
      '[Private](/api/%64ocuments/download/document-1)', 'text',
      { ...mixed, allowInlineImages: true, suppressProtectedContent: false, deniedDocumentIds: new Set(['document-1']) },
    );
    const encodedPrefix = await redactTicketEmailRenderedContent(
      'Private https://alga.test/%61pi/%64ocuments/view/file-1 and /%61%70%69/documents/download/document-1',
      'text', mixed,
    );
    const deniedWithPunctuation = await redactTicketEmailRenderedContent(
      'See https://alga.test/%61pi/documents/view/document-1. Then /api/documents/document-1/preview/,',
      'text',
      { ...mixed, allowInlineImages: true, suppressProtectedContent: false, deniedDocumentIds: new Set(['document-1']) },
    );

    expect(JSON.stringify(structured.content)).not.toContain('%64ocuments');
    expect(JSON.stringify(structured.content)).toContain('https://example.test/help');
    expect(html.value).toContain('https://example.test/help');
    expect(html.value).not.toContain('document-1');
    expect(text.value).not.toMatch(/file-1|token=secret/);
    expect(denied.value).toBe('[Protected content not included]');
    expect(encodedPrefix.value).not.toMatch(/file-1|document-1/);
    expect(deniedWithPunctuation.value).toBe(
      'See [Protected content not included]. Then [Protected content not included],',
    );
  });

  it('redacts document routes used by the client portal and versioned APIs', async () => {
    const paths = [
      '/api/documents/document-1/download',
      '/api/documents/document-1/preview/',
      '/api/documents/view/document-1/',
      '/api/client-portal/documents/document-1/file',
      '/api/v1/documents/document-1',
      '/api/v1/tickets/ticket-1/documents/document-1/preview',
      '/api/v1/assets/asset-1/documents/document-1',
      '/api/v1/assets/documents/document-1',
      '/api/client-portal/%64ocuments/document-1/file',
    ];
    const content = paths.map(href => ({
      type: 'paragraph',
      content: [{ type: 'link', href, content: [{ type: 'text', text: 'Private', styles: {} }] }],
    }));
    const structured = redactTicketEmailStructuredContent(content, mixed);
    const html = await redactTicketEmailRenderedContent(
      paths.map(path => `<a href="${path}">Private</a>`).join(' '), 'html', mixed,
    );
    const text = await redactTicketEmailRenderedContent(paths.join(' '), 'text', mixed);
    const deniedPolicy = {
      ...mixed, allowInlineImages: true, suppressProtectedContent: false, deniedDocumentIds: new Set(['document-1']),
    };
    const deniedStructured = redactTicketEmailStructuredContent(content, deniedPolicy);
    const deniedHtml = await redactTicketEmailRenderedContent(
      paths.map(path => `<a href="${path}">Private</a>`).join(' '), 'html', deniedPolicy,
    );
    const deniedText = await redactTicketEmailRenderedContent(paths.join(' '), 'text', deniedPolicy);

    expect(JSON.stringify(structured.content)).not.toContain('document-1');
    expect(html.value).not.toContain('document-1');
    expect(text.value).not.toContain('document-1');
    expect(JSON.stringify(deniedStructured.content)).not.toContain('document-1');
    expect(deniedHtml.value).toContain('[Protected content not included]');
    expect(deniedHtml.value).not.toContain('document-1');
    expect(deniedText.value).not.toContain('document-1');
  });

  it('redacts encoded protected links and alternative image markup in legacy HTML', async () => {
    const html = '<p>Keep <a href="https://example.test/help">Help</a> ' +
      '<a href="&#47;api&#47;documents&#47;download&#47;secret">Private</a></p>' +
      '<div style="color:red;background-image:url(https://example.test/private.png)">Details</div>' +
      '<svg><image href="https://example.test/private.svg"></image></svg>';
    const result = await redactTicketEmailRenderedContent(html, 'html', mixed);

    expect(result.redacted).toBe(true);
    expect(result.value).toContain('Keep');
    expect(result.value).toContain('Details');
    expect(result.value).toContain('href="https://example.test/help"');
    expect(result.value).toContain('[Protected content not included]');
    expect(result.value).toContain('color: red;');
    expect(result.value).not.toMatch(/secret|private\.png|private\.svg|<svg/i);
  });

  it('removes alternate image sources for external-only recipients without discarding safe styles', async () => {
    const html = '<p>Details <a href="https://example.test/help">Help</a> ' +
      '<a href="data:image/png;base64,YQ==">Image</a></p>' +
      '<div style="background-image:image-set(\'https://example.test/a.png\' 1x);color:blue">One</div>' +
      '<div style="background-image:u\\72l(https://example.test/b.png)">Two</div>' +
      '<table background="https://example.test/c.png"><tbody><tr><td>Three</td></tr></tbody></table>' +
      '<video poster="https://example.test/d.png" src="https://example.test/movie.mp4"></video>' +
      '<input type="IMAGE" src="https://example.test/e.png">';
    const result = await redactTicketEmailRenderedContent(html, 'html', {
      ...mixed, suppressProtectedContent: false,
    });

    expect(result.redacted).toBe(true);
    expect(result.value).toContain('href="https://example.test/help"');
    expect(result.value).toContain('color: blue;');
    expect(result.value).toContain('https://example.test/movie.mp4');
    expect(result.value).toContain('One');
    expect(result.value).toContain('Two');
    expect(result.value).toContain('Three');
    expect(result.value).not.toMatch(/data:image|[abcde]\.png|<input/i);
  });

  it('removes legacy HTML images and media in both HTML and text fields', async () => {
    const value = 'Keep <img src="https://example.test/secret.png"> ' +
      '<video src="https://example.test/private.mp4">Private video</video> ' +
      '<iframe src="https://example.test/embed"></iframe> ' +
      '<embed src="https://example.test/file"> Help';
    for (const format of ['html', 'text'] as const) {
      const result = await redactTicketEmailRenderedContent(value, format, mixed);
      expect(result.redacted).toBe(true);
      expect(result.value).toContain('Keep');
      expect(result.value).toContain('Help');
      expect(result.value).toContain('[Image not included]');
      expect(result.value).toContain('[Protected content not included]');
      expect(result.value).not.toMatch(/secret\.png|private\.mp4|\/embed|example\.test\/file|<(?:img|video|iframe|embed)/);
    }
  });

  it('keeps non-image media for a verified external-only audience', () => {
    const content = [
      { type: 'image', props: { url: '/api/documents/view/file-1' } },
      { type: 'file', props: { url: '/api/documents/download/doc-1', name: 'Report' } },
    ];
    const result = redactTicketEmailStructuredContent(content, {
      ...mixed, suppressProtectedContent: false,
    });
    const rendered = formatBlockNoteContent(result.content);
    expect(rendered.html).toContain('[Image not included]');
    expect(rendered.html).toContain('/api/documents/download/doc-1');
    expect(rendered.html).not.toContain('file-1');
  });
});
