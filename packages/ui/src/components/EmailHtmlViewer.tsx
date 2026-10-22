'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

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

const FRAME_STYLES = [
  'html,body{margin:0;padding:0;background:#ffffff;}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
  'font-size:14px;line-height:1.5;color:#111827;overflow-wrap:anywhere;}',
  'img{max-width:100%;height:auto;}',
  'table{max-width:100%;}',
  'blockquote{margin:0 0 0 0.75rem;padding-left:0.75rem;border-left:2px solid #d1d5db;color:#4b5563;}',
].join('');

function toFrameDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">`
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

export interface InboundEmailBodyProps {
  id?: string;
  /** Endpoint for the formatted view; the toggle disappears when it 404s. */
  src: string;
  labels: {
    text: string;
    originalEmail: string;
    loading: string;
    error: string;
    /** Group label for assistive technology. */
    group?: string;
  };
  /** The stored rich-text body, shown until the reader asks for the original. */
  children: React.ReactNode;
}

/**
 * Pairs a stored comment/description body with the archived original behind a
 * two-state toggle. The original is fetched on the first switch only.
 */
export function InboundEmailBody({ id, src, labels, children }: InboundEmailBodyProps) {
  const [mode, setMode] = useState<'text' | 'email'>('text');
  const [unavailable, setUnavailable] = useState(htmlCache.get(src) === null);

  const handleUnavailable = useCallback(() => {
    setUnavailable(true);
    setMode('text');
  }, []);

  const option = (value: 'text' | 'email', label: string) => (
    <button
      id={id ? `${id}-${value}-toggle` : undefined}
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        'rounded px-2 py-0.5 transition-colors',
        mode === value
          ? 'bg-[rgb(var(--color-border-100))] font-semibold text-[rgb(var(--color-text-700))]'
          : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
      )}
    >
      {label}
    </button>
  );

  return (
    <div id={id} className="min-w-0">
      {!unavailable && (
        <div
          role="group"
          aria-label={labels.group ?? labels.originalEmail}
          className="mb-1 inline-flex items-center gap-0.5 text-xs"
        >
          {option('text', labels.text)}
          {option('email', labels.originalEmail)}
        </div>
      )}
      {mode === 'email' && !unavailable ? (
        <EmailHtmlViewer
          id={id ? `${id}-frame` : undefined}
          src={src}
          title={labels.originalEmail}
          loadingLabel={labels.loading}
          errorLabel={labels.error}
          onUnavailable={handleUnavailable}
        />
      ) : (
        children
      )}
    </div>
  );
}

export default EmailHtmlViewer;
