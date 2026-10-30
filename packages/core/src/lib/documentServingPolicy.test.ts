import { describe, it, expect } from 'vitest';
import { resolveDocumentServingPolicy, buildContentDisposition } from './documentServingPolicy';
import { isPreviewableDocumentMimeType } from './documentMimeType';

describe('resolveDocumentServingPolicy', () => {
  it.each([
    'image/svg+xml',
    'text/html',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'application/atom+xml',
    'IMAGE/SVG+XML; charset=utf-8',
  ])('never renders %s inline', (mime) => {
    const p = resolveDocumentServingPolicy(mime);
    expect(p.disposition).toBe('attachment');
    expect(p.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(p.headers['Content-Security-Policy']).toBeUndefined();
  });

  it('keeps SVG servable so old /view links download', () => {
    expect(resolveDocumentServingPolicy('IMAGE/SVG+XML; charset=utf-8').servable).toBe(true);
  });

  it.each(['image/png', 'image/jpeg', 'application/pdf', 'video/mp4'])('renders %s inline with sandbox CSP', (mime) => {
    const p = resolveDocumentServingPolicy(mime);
    expect(p.servable).toBe(true);
    expect(p.disposition).toBe('inline');
    expect(p.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(p.headers['Content-Security-Policy']).toContain('sandbox');
  });

  it.each(['video/webm', 'video/mp4'])('allows same-origin media for %s inline while staying sandboxed', (mime) => {
    const p = resolveDocumentServingPolicy(mime);
    const csp = p.headers['Content-Security-Policy'];
    expect(p.disposition).toBe('inline');
    expect(csp).toContain("media-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox allow-same-origin');
    expect(csp).not.toContain('allow-scripts');
    expect(p.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it.each(['image/png', 'application/pdf', 'text/plain'])('keeps bare sandbox for %s', (mime) => {
    const csp = resolveDocumentServingPolicy(mime).headers['Content-Security-Policy'];
    expect(csp).toContain('sandbox');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-scripts');
  });

  it('still serves SVG as an attachment', () => {
    expect(resolveDocumentServingPolicy('image/svg+xml').disposition).toBe('attachment');
  });

  it('keeps the servable set unchanged', () => {
    for (const m of ['text/plain', 'text/html', 'audio/wav', 'application/zip', '', null, undefined]) {
      expect(isPreviewableDocumentMimeType(m)).toBe(false);
    }
    expect(resolveDocumentServingPolicy('text/plain').disposition).toBe('inline');
  });
});

describe('buildContentDisposition', () => {
  it('omits filename when absent and escapes when present', () => {
    expect(buildContentDisposition('attachment')).toBe('attachment');
    expect(buildContentDisposition('inline', 'a"b.png')).toContain('filename="a_b.png"');
    expect(buildContentDisposition('attachment', 'a\\')).toContain('filename="a_"');
    expect(buildContentDisposition('attachment', 'a\\')).not.toContain('\\"');
  });
});
