/**
 * @vitest-environment jsdom
 *
 * The frame document is written as a string, so neither the theme-literal gate
 * nor a styling review can see it the way it sees a className. These two
 * properties are the ones whose failure is silent: a hardcoded palette that
 * cannot follow the reader's theme, and a sandbox that quietly gains the one
 * flag that would let sender markup run.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmailHtmlViewer } from './EmailHtmlViewer';

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

async function renderFrame(src: string): Promise<HTMLIFrameElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ html: '<p>Hello</p>' }),
    })) as unknown as typeof fetch
  );

  render(
    <EmailHtmlViewer
      id="email-frame"
      src={src}
      title="Original email"
      loadingLabel="Loading the original email…"
      errorLabel="The original email is unavailable"
    />
  );

  return (await screen.findByTitle('Original email')) as HTMLIFrameElement;
}

describe('EmailHtmlViewer frame document', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pins a light colour scheme instead of hardcoding a palette', async () => {
    const frame = await renderFrame('/api/tickets/t1/email-html');
    const srcDoc = frame.getAttribute('srcdoc') ?? '';

    // Custom properties do not cross a document boundary, so the sheet cannot
    // theme; it declares the scheme it renders in and takes the system palette
    // that scheme resolves.
    expect(srcDoc).toContain('<meta name="color-scheme" content="light">');
    expect(srcDoc).toContain('color-scheme:light');
    expect(srcDoc).toContain('background:Canvas');
    expect(srcDoc).toContain('color:CanvasText');
    expect(srcDoc.replace('<p>Hello</p>', '')).not.toMatch(COLOUR_LITERAL);
  });

  it('withholds allow-scripts from the frame', async () => {
    const frame = await renderFrame('/api/tickets/t2/email-html');
    const sandbox = frame.getAttribute('sandbox') ?? '';

    // Everything else in here — event handlers, javascript: URLs, nested
    // frames — is inert only because this flag is absent.
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).toContain('allow-popups');
  });
});
