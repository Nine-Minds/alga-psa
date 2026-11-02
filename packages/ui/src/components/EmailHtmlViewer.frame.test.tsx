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

/** `.dark` plus the two tokens the frame reads out of `<html>`. */
function applyDarkTheme(): void {
  const root = document.documentElement;
  root.classList.add('dark');
  root.style.setProperty('--color-card', '30 24 54');
  root.style.setProperty('--color-border-400', '75 61 115');
}

describe('EmailHtmlViewer frame document', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    const root = document.documentElement;
    root.classList.remove('dark');
    root.removeAttribute('style');
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

  it('grounds the sheet on the app card in dark mode', async () => {
    applyDarkTheme();
    const frame = await renderFrame('/api/tickets/t4/email-html');
    const srcDoc = frame.getAttribute('srcdoc') ?? '';

    // The white block the reader complained about: the sheet's ground is the
    // card the frame sits on, and the frame's own scrollbar follows it.
    expect(srcDoc).toContain('background:rgb(30 24 54)!important');
    expect(srcDoc).toContain('scrollbar-color:rgb(75 61 115) rgb(30 24 54)');
    expect(srcDoc).toContain('background:transparent!important');

    // Flipping a sheet that still renders light is what keeps the sender's own
    // contrast: on a plain dark canvas their `color:#000` would vanish.
    expect(srcDoc).toContain('color-scheme:light');
    expect(srcDoc).toContain('filter:invert(1) hue-rotate(180deg)!important');
    expect(srcDoc).toContain('img,picture,video,svg{filter:invert(1) hue-rotate(180deg);}');
  });

  it('keeps the light sheet when the card token cannot be read', async () => {
    // Only `.dark`, no tokens: a canvas that cannot be read cannot be matched,
    // and a guessed shade of dark would be worse than the sheet it replaces.
    document.documentElement.classList.add('dark');
    const frame = await renderFrame('/api/tickets/t5/email-html');
    const srcDoc = frame.getAttribute('srcdoc') ?? '';

    expect(srcDoc).toContain('background:Canvas');
    expect(srcDoc).not.toContain('invert(1)');
  });

  it('backs the host frame with the card token, not bg-white', async () => {
    const frame = await renderFrame('/api/tickets/t3/email-html');

    // `bg-white` only survives dark mode through the legacy global shim; the
    // corners of the frame have to match the card without it.
    expect(frame.className).not.toContain('bg-white');
    expect(frame.className).toContain('bg-[rgb(var(--color-card))]');
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
