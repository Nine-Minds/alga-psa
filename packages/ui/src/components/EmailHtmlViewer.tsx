'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, Mail } from 'lucide-react';
import { cn } from '../lib/utils';
import ViewSwitcher from './ViewSwitcher';
import { useInboundEmailViewMode, type InboundEmailViewMode } from '../lib/inboundEmailViewMode';

/**
 * Formatted view of an archived inbound email.
 *
 * The stored comment body is the lossy rich-text conversion of the message;
 * this renders the original instead, fetched from an endpoint that returns
 * `{ html }` already sanitized server-side. A `404` means the archive has no
 * renderable source, which is reported through `onUnavailable` so the host can
 * drop its toggle rather than show an error.
 *
 * The document is isolated in an iframe that withholds `allow-scripts`, so no
 * script, event handler or `javascript:` URL in sender markup can execute —
 * and sandbox flags are inherited by nested frames, so that holds for the whole
 * subtree. `allow-same-origin` is therefore safe and is what lets the parent
 * measure the rendered height; without `allow-forms` the document cannot post
 * anywhere either. Links are already rewritten to `target="_blank"`, and
 * `allow-popups-to-escape-sandbox` lets the page they open behave normally.
 */

/**
 * Resolved endpoint responses, so toggling back and forth does not refetch an
 * immutable archive. `null` = no formatted view exists (404). Bounded: a long
 * reading session should not accumulate every message body it looked at.
 */
const htmlCache = new Map<string, string | null>();
const HTML_CACHE_LIMIT = 20;

function rememberHtml(src: string, value: string | null): void {
  htmlCache.set(src, value);
  while (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next();
    if (oldest.done) break;
    htmlCache.delete(oldest.value);
  }
}

const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/**
 * The frame stays a light sheet in both app themes, and says so with
 * `color-scheme: light` rather than a hardcoded palette.
 *
 * Senders author mail against a white background with their own ink: a dark
 * canvas turns black-on-white signatures, table rules and inline-styled
 * headings invisible, and fidelity to what the sender sent is the entire point
 * of this view — so re-tinting it would break the feature, not theme it. The
 * app's tokens cannot reach in here anyway (custom properties do not cross a
 * document boundary), so pinning the scheme is also what makes the colours
 * below resolvable: `Canvas`/`CanvasText`/`GrayText` are the system palette
 * that scheme selects, and it keeps the sheet's own scrollbars and form
 * controls light instead of letting an OS dark theme paint them onto white.
 */
const FRAME_STYLES = [
  ':root{color-scheme:light;}',
  'html,body{margin:0;padding:0;background:Canvas;color:CanvasText;}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
  'font-size:14px;line-height:1.5;overflow-wrap:anywhere;}',
  'img{max-width:100%;height:auto;}',
  'table{max-width:100%;}',
  'blockquote{margin:0 0 0 0.75rem;padding-left:0.75rem;border-left:2px solid GrayText;color:GrayText;}',
].join('');

function toFrameDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="color-scheme" content="light">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>${FRAME_STYLES}</style></head><body>${html}</body></html>`;
}

export interface EmailHtmlViewerProps {
  id?: string;
  /** Endpoint returning `{ html }` for the archived message. */
  src: string;
  /** Accessible name of the frame. */
  title: string;
  loadingLabel: string;
  errorLabel: string;
  /** Called when the endpoint has no formatted view to serve (404). */
  onUnavailable?: () => void;
  /** Tallest the frame grows before it scrolls internally. */
  maxHeight?: number;
  className?: string;
}

export function EmailHtmlViewer({
  id,
  src,
  title,
  loadingLabel,
  errorLabel,
  onUnavailable,
  maxHeight = 1200,
  className,
}: EmailHtmlViewerProps) {
  const cached = htmlCache.get(src);
  const [html, setHtml] = useState<string | null>(cached ?? null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    cached === undefined ? 'loading' : cached ? 'ready' : 'error'
  );
  const [height, setHeight] = useState(240);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (htmlCache.has(src)) {
      const entry = htmlCache.get(src) ?? null;
      setHtml(entry);
      setStatus(entry ? 'ready' : 'error');
      if (!entry) onUnavailable?.();
      return;
    }

    let active = true;
    setStatus('loading');
    void (async () => {
      try {
        const response = await fetch(src, { headers: { Accept: 'application/json' } });
        if (response.status === 404) {
          rememberHtml(src, null);
          if (!active) return;
          setStatus('error');
          onUnavailable?.();
          return;
        }
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        const payload = (await response.json()) as { html?: unknown };
        const value = typeof payload.html === 'string' ? payload.html : '';
        if (!value) throw new Error('Empty response');
        rememberHtml(src, value);
        if (!active) return;
        setHtml(value);
        setStatus('ready');
      } catch {
        // Not cached: a transient failure must stay retryable.
        if (active) setStatus('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [src, onUnavailable]);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const next = Math.max(body.scrollHeight, body.offsetHeight);
      if (next > 0) setHeight(Math.min(next + 8, maxHeight));
    } catch {
      // Opaque-origin frame (older browser sandbox behavior): keep the default.
    }
  }, [maxHeight]);

  const handleLoad = useCallback(() => {
    measure();
    // Remote images settle after load; re-measure while they arrive.
    const frame = frameRef.current;
    try {
      const body = frame?.contentDocument?.body;
      if (!body || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => measure());
      observer.observe(body);
      window.setTimeout(() => observer.disconnect(), 5000);
    } catch {
      // No same-origin access: the single measurement above is all we get.
    }
  }, [measure]);

  if (status === 'loading') {
    return (
      <p id={id ? `${id}-loading` : undefined} className="py-2 text-xs text-[rgb(var(--color-text-500))]">
        {loadingLabel}
      </p>
    );
  }

  if (status === 'error' || !html) {
    return (
      <p id={id ? `${id}-error` : undefined} className="py-2 text-xs text-[rgb(var(--color-text-500))]">
        {errorLabel}
      </p>
    );
  }

  return (
    <iframe
      id={id}
      ref={frameRef}
      title={title}
      sandbox={SANDBOX}
      srcDoc={toFrameDocument(html)}
      onLoad={handleLoad}
      style={{ height }}
      className={cn(
        'w-full min-w-0 rounded-md border border-[rgb(var(--color-border-200))] bg-white',
        className
      )}
    />
  );
}

export interface InboundEmailViewLabels {
  text: string;
  originalEmail: string;
  /** Compact switcher label for the original; falls back to `originalEmail`. */
  emailShort?: string;
  loading: string;
  error: string;
  /** Group label for assistive technology. */
  group?: string;
}

export interface InboundEmailViewOptions {
  id?: string;
  /** Endpoint for the formatted view, or `null` for a record that is not from mail. */
  src: string | null;
  labels: InboundEmailViewLabels;
  /** Placement classes for the switcher inside the caller's heading row. */
  switcherClassName?: string;
}

export interface InboundEmailView {
  /** Compact switcher for the heading row; `null` when there is no original to offer. */
  switcher: React.ReactNode;
  /** Wraps the stored body, swapping in the archived original on demand. */
  body: (storedBody: React.ReactNode) => React.ReactNode;
}

/**
 * Pairs a stored comment/description body with the archived original behind a
 * compact view switcher. The original is fetched on the first switch only.
 *
 * Switcher and body come back separately because they belong in different
 * places: the switcher rides the heading row the record already has, where it
 * costs no vertical space, while the body stays where the stored text was —
 * often inside a clamp or a `prose` container that the switcher must stay out
 * of. The reader's choice comes from the shared view-mode preference rather
 * than local state, so it carries to every other message and every other
 * ticket; a record whose archive turns out to be missing withdraws its own
 * switcher without disturbing that preference.
 */
export function useInboundEmailView({
  id,
  src,
  labels,
  switcherClassName,
}: InboundEmailViewOptions): InboundEmailView {
  const [mode, setMode] = useInboundEmailViewMode();
  const [missing, setMissing] = useState<string | null>(null);

  const markUnavailable = useCallback(() => {
    setMissing(src);
  }, [src]);

  const available = src !== null && missing !== src && htmlCache.get(src) !== null;

  const switcher = available ? (
    <ViewSwitcher<InboundEmailViewMode>
      currentView={mode}
      onChange={setMode}
      size="sm"
      className={cn('w-fit shrink-0', switcherClassName)}
      aria-label={labels.group ?? labels.originalEmail}
      options={[
        {
          value: 'text',
          label: labels.text,
          icon: AlignLeft,
          id: id ? `${id}-text-toggle` : 'inbound-email-text-toggle',
        },
        {
          value: 'email',
          label: labels.emailShort ?? labels.originalEmail,
          icon: Mail,
          id: id ? `${id}-email-toggle` : 'inbound-email-original-toggle',
        },
      ]}
    />
  ) : null;

  const body = (storedBody: React.ReactNode): React.ReactNode => {
    if (src === null) return storedBody;
    return (
      <div id={id} className="min-w-0">
        {available && mode === 'email' ? (
          <EmailHtmlViewer
            id={id ? `${id}-frame` : undefined}
            src={src}
            title={labels.originalEmail}
            loadingLabel={labels.loading}
            errorLabel={labels.error}
            onUnavailable={markUnavailable}
          />
        ) : (
          storedBody
        )}
      </div>
    );
  };

  return { switcher, body };
}

export default EmailHtmlViewer;
