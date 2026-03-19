type TicketRichTextNavigationDecision =
  | { allow: true }
  | { allow: false; externalUrl?: string };

export function createTicketRichTextInjectionScript(message: string): string {
  return `window.__ticketMobileEditorHandleNativeMessage(${JSON.stringify(message)}); true;`;
}

export function getTicketRichTextNavigationDecision(
  url: string,
  baseUrl: string,
): TicketRichTextNavigationDecision {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { allow: false };
  }

  const normalizedBaseUrl = baseUrl.toLowerCase();
  const normalizedUrl = trimmedUrl.toLowerCase();

  if (
    normalizedUrl === "about:blank"
    || normalizedUrl.startsWith("about:blank#")
    || normalizedUrl.startsWith("data:text/html")
    || normalizedUrl.startsWith(normalizedBaseUrl)
  ) {
    return { allow: true };
  }

  return {
    allow: false,
    externalUrl: trimmedUrl,
  };
}

function extractBlockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }

  const content = (block as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      if ((item as { type?: unknown }).type === "link") {
        const linkedContent = (item as { content?: unknown }).content;
        if (!Array.isArray(linkedContent)) {
          return "";
        }

        return linkedContent
          .map((linkedItem) => {
            const text = (linkedItem as { text?: unknown })?.text;
            return typeof text === "string" ? text : "";
          })
          .join("");
      }

      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function extractProseMirrorText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }

  const record = node as {
    type?: unknown;
    text?: unknown;
    content?: unknown;
  };

  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }

  if (record.type === "hardBreak") {
    return "\n";
  }

  if (!Array.isArray(record.content)) {
    return "";
  }

  return record.content.map(extractProseMirrorText).join("");
}

export function extractPlainTextFromRichEditorJson(json: unknown): string {
  if (typeof json === "string") {
    return json;
  }

  if (Array.isArray(json)) {
    return json
      .map(extractBlockText)
      .filter(Boolean)
      .join("\n");
  }

  if (json && typeof json === "object" && (json as { type?: unknown }).type === "doc") {
    return extractProseMirrorText(json).trim();
  }

  return "";
}

export function extractPlainTextFromSerializedRichEditorContent(
  content: string | null | undefined,
): string {
  if (!content) {
    return "";
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return extractPlainTextFromRichEditorJson(JSON.parse(trimmed));
    } catch {
      return content;
    }
  }

  return content;
}

export function isMalformedRichEditorContent(
  content: string | null | undefined,
): boolean {
  if (!content) {
    return false;
  }

  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

export function serializeRichEditorJson(json: unknown): string {
  return JSON.stringify(json);
}
