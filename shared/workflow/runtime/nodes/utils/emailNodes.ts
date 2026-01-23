type ParseEmailResult = {
  success: boolean;
  parsed?: {
    sanitizedText?: string;
    sanitizedHtml?: string;
    confidence?: string;
    strategy?: string;
    appliedHeuristics?: string[];
    warnings?: string[];
    tokens?: Record<string, unknown>;
  } | null;
};

type ParsedBody = {
  sanitizedText: string;
  sanitizedHtml?: string;
  confidence: string;
  metadata: Record<string, unknown>;
};

export async function parseEmailBodyWithFallback(
  callAction: (actionId: string, version: number, args: any, options?: { idempotencyKey?: string }) => Promise<any>,
  params: { text?: string; html?: string }
): Promise<ParsedBody> {
  try {
    const parseResult = (await callAction('parse_email_reply', 1, {
      text: params.text,
      html: params.html
    })) as ParseEmailResult;

    if (!parseResult?.success || !parseResult.parsed) {
      return createFallback(params, ['parser-unavailable']);
    }

    const parsed = parseResult.parsed;
    const sanitizedText = parsed.sanitizedText || params.text || '';
    const sanitizedHtml = parsed.sanitizedHtml || undefined;
    const parserMeta: Record<string, unknown> = {
      confidence: parsed.confidence,
      strategy: parsed.strategy,
      heuristics: parsed.appliedHeuristics,
      warnings: parsed.warnings,
      tokens: parsed.tokens || null
    };

    if (parsed.confidence === 'low') {
      parserMeta.rawText = truncate(params.text);
      parserMeta.rawHtml = truncate(params.html);
    }

    const metadata: Record<string, unknown> = {
      parser: parserMeta
    };

    return {
      sanitizedText,
      sanitizedHtml,
      confidence: parsed.confidence || 'low',
      metadata
    };
  } catch (error) {
    return createFallback(params, ['parser-error'], error instanceof Error ? error.message : String(error));
  }
}

export async function renderCommentBlocksWithFallback(
  callAction: (actionId: string, version: number, args: any, options?: { idempotencyKey?: string }) => Promise<any>,
  params: { html?: string; text?: string }
): Promise<unknown> {
  if (params.html) {
    try {
      const result = await callAction('convert_html_to_blocks', 1, { html: params.html });
      if (result?.success && result.blocks) {
        return result.blocks;
      }
    } catch (error) {
      // ignore and fallback
    }
  }
  return [{ type: 'paragraph', content: [{ type: 'text', text: params.text || '' }] }];
}

function createFallback(params: { text?: string; html?: string }, warnings: string[], errorMessage?: string): ParsedBody {
  return {
    sanitizedText: params.text || '',
    sanitizedHtml: params.html,
    confidence: 'low',
    metadata: {
      parser: {
        confidence: 'low',
        warnings,
        error: errorMessage,
        rawText: truncate(params.text),
        rawHtml: truncate(params.html)
      }
    }
  };
}

function truncate(value?: string, maxLength = 4000): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
