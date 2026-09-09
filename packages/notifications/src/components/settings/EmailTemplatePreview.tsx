'use client';

import { useEffect, useMemo, useRef } from "react";
import { Label } from "@alga-psa/ui/components/Label";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getSampleDataForPreview } from "../../lib/templateSampleData";

/**
 * Replace {{variable}} placeholders in content with sample data values.
 * Supports both simple ({{name}}) and dotted ({{user.name}}) variables.
 */
export function replaceTemplateVariables(
  content: string,
  data: Record<string, string>
): string {
  // First, process {{#if condition}}...{{/if}} blocks.
  // For preview, show the block content (with variables replaced) since sample data is available.
  let result = content.replace(
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
}: {
  htmlContent: string;
  templateName: string;
  subject?: string;
  id?: string;
}) {
  const { t } = useTranslation('msp/settings');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sampleData = useMemo(
    () => getSampleDataForPreview(templateName, htmlContent, subject),
    [templateName, htmlContent, subject]
  );

  const renderedHtml = useMemo(
    () => replaceTemplateVariables(htmlContent, sampleData),
    [htmlContent, sampleData]
  );

  const renderedSubject = useMemo(
    () => subject ? replaceTemplateVariables(subject, sampleData) : undefined,
    [subject, sampleData]
  );

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
      } catch {
        // sandbox may restrict access
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [renderedHtml]);

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
