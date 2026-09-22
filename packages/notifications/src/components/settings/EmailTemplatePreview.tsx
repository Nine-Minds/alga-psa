'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@alga-psa/ui/components/Label";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { resolveBrandLogoForPreview, type BrandLogoPreviewUrls } from "@alga-psa/email/branding";
import { getSampleDataForPreview } from "../../lib/templateSampleData";
import {
  annotateHtmlSource,
  parseSourceRange,
  SOURCE_RANGE_ATTRIBUTE,
  type SourceRange,
} from "./emailTemplateSourceMap";

const ACTIVE_CLASS = 'alga-src-active';

const SOURCE_MAP_STYLES = `
  [${SOURCE_RANGE_ATTRIBUTE}]:hover { outline: 1px dashed rgba(37, 99, 235, 0.7); outline-offset: -1px; cursor: pointer; }
  .${ACTIVE_CLASS} { outline: 2px solid rgb(37, 99, 235) !important; outline-offset: -1px; }
`;

/**
 * Replace {{variable}} placeholders in content with sample data values.
 * Supports both simple ({{name}}) and dotted ({{user.name}}) variables.
 */
export function replaceTemplateVariables(
  content: string,
  data: Record<string, string>
): string {
  // Expand {{#each path}}...{{/each}} blocks once for preview, qualifying
  // {{this.*}} references (including {{#if this.*}}) against the block's path
  // so the registry's per-item examples (e.g. credits.items.creditId) resolve.
  let result = content.replace(
    /\{\{#each\s+([^{}\s]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, path, blockContent: string) =>
      blockContent.replace(
        /(\{{2,3})(#if\s+)?this\.([^{}]+?)(\}{2,3})/g,
        (_inner, open, ifTag, key, close) => `${open}${ifTag ?? ''}${path}.${key}${close}`
      )
  );

  // Then, process {{#if condition}}...{{/if}} blocks.
  // For preview, show the block content (with variables replaced) since sample data is available.
  result = result.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, _condition, blockContent) => blockContent
  );

  // Then replace simple {{variable}} and raw-HTML {{{variable}}} placeholders.
  // In the iframe preview we render HTML either way, so we treat both forms the same.
  result = result.replace(/\{{2,3}([^{}]+)\}{2,3}/g, (match, key) => {
    const trimmedKey = key.trim();
    return trimmedKey in data ? data[trimmedKey] : match;
  });

  return result;
}

/**
 * Renders HTML content in a sandboxed iframe for email template preview.
 */
export function EmailTemplatePreview({
  htmlContent,
  templateName,
  subject,
  id,
  brandLogoUrls,
  sourceMap,
  highlightOffset,
  onSelectSource,
}: {
  htmlContent: string;
  templateName: string;
  subject?: string;
  id?: string;
  /**
   * Branding URLs for the embedded logo. A stored row references it as
   * `cid:alga-brand-logo`, which only a mail client resolves; here the iframe
   * loads the URL instead.
   */
  brandLogoUrls?: BrandLogoPreviewUrls;
  /** Links what is rendered back to the HTML source, for the side-by-side editor. */
  sourceMap?: boolean;
  /** Caret offset in the source; the element around it is outlined. */
  highlightOffset?: number | null;
  /** Fired with the source range of whatever was clicked in the preview. */
  onSelectSource?: (range: SourceRange) => void;
}) {
  const { t } = useTranslation('msp/settings');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const selectSourceRef = useRef(onSelectSource);
  selectSourceRef.current = onSelectSource;

  const sampleData = useMemo(
    () => getSampleDataForPreview(templateName, htmlContent, subject),
    [templateName, htmlContent, subject]
  );

  // The two URLs, not the object: callers pass the status field straight
  // through, and a parent that rebuilds it per render must not re-resolve.
  const logoUrl = brandLogoUrls?.logoUrl;
  const logoWideUrl = brandLogoUrls?.logoWideUrl;

  const renderedHtml = useMemo(
    () => {
      const annotated = sourceMap ? annotateHtmlSource(htmlContent) : htmlContent;
      // After the annotation, never before: swapping the cid for a URL changes
      // the length, and the stamped offsets describe the source being edited.
      const resolved = logoUrl || logoWideUrl
        ? resolveBrandLogoForPreview(annotated, { logoUrl, logoWideUrl })
        : annotated;
      return replaceTemplateVariables(resolved, sampleData);
    },
    [htmlContent, sampleData, sourceMap, logoUrl, logoWideUrl]
  );

  const renderedSubject = useMemo(
    () => subject ? replaceTemplateVariables(subject, sampleData) : undefined,
    [subject, sampleData]
  );

  // Clicking the rendered email selects the markup it came from.
  const handleDocumentClick = useCallback((event: Event) => {
    const target = event.target as Element | null;
    const marked = target?.closest?.(`[${SOURCE_RANGE_ATTRIBUTE}]`);
    const range = parseSourceRange(marked?.getAttribute(SOURCE_RANGE_ATTRIBUTE));
    if (range) selectSourceRef.current?.(range);
  }, []);

  // Auto-resize iframe to content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          iframe.style.height = `${doc.body.scrollHeight + 20}px`;
        }
        if (doc && sourceMap) {
          const style = doc.createElement('style');
          style.textContent = SOURCE_MAP_STYLES;
          (doc.head ?? doc.body)?.appendChild(style);
          doc.addEventListener('click', handleDocumentClick);
          setDocumentEpoch((epoch) => epoch + 1);
        }
      } catch {
        // sandbox may restrict access
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
      try {
        iframe.contentDocument?.removeEventListener('click', handleDocumentClick);
      } catch {
        // sandbox may restrict access
      }
    };
  }, [renderedHtml, sourceMap, handleDocumentClick]);

  // Outline whichever element the source caret currently sits in.
  useEffect(() => {
    if (!sourceMap) return;
    let doc: Document | null = null;
    try {
      doc = iframeRef.current?.contentDocument ?? null;
    } catch {
      return;
    }
    if (!doc) return;

    doc.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((element) => element.classList.remove(ACTIVE_CLASS));
    if (highlightOffset == null) return;

    const containing = Array.from(doc.querySelectorAll(`[${SOURCE_RANGE_ATTRIBUTE}]`))
      .map((element) => ({ element, range: parseSourceRange(element.getAttribute(SOURCE_RANGE_ATTRIBUTE)) }))
      .filter((candidate): candidate is { element: Element; range: SourceRange } =>
        !!candidate.range && highlightOffset >= candidate.range.start && highlightOffset <= candidate.range.end)
      .sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start));

    const match = containing[0]?.element;
    if (!match) return;
    match.classList.add(ACTIVE_CLASS);
    match.scrollIntoView({ block: 'nearest' });
  }, [sourceMap, highlightOffset, documentEpoch]);

  return (
    <div className="space-y-2">
      {renderedSubject && (
        <div>
          <Label className="text-xs text-gray-500">{t('notifications.emailTemplatesUi.preview.subjectLabel', 'Subject Preview')}</Label>
          <div className="p-2 bg-gray-50 rounded border text-sm">
            {renderedSubject}
          </div>
        </div>
      )}
      <div className="border rounded overflow-hidden">
        <iframe
          id={id}
          ref={iframeRef}
          srcDoc={renderedHtml}
          sandbox="allow-same-origin"
          title={t('notifications.emailTemplatesUi.preview.iframeTitle', 'Email template preview')}
          className="w-full min-h-[200px] bg-white"
          style={{ border: 'none' }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {t('notifications.emailTemplatesUi.preview.sampleDataNote', 'Preview uses sample data. Actual emails will contain real values.')}
      </p>
    </div>
  );
}
