export interface ParsedAssistantContent {
  raw: string;
  display: string;
  reasoning?: string;
}

const REASONING_TYPES = new Set(['reasoning', 'thinking', 'chain_of_thought', 'analysis']);

const stripThinkingTags = (input: string) => {
  const reasoningSegments: string[] = [];
  let sanitized = input;

  const regex = /<think>([\s\S]*?)<\/think>/gi;
  sanitized = sanitized.replace(regex, (_match, inner) => {
    const text = typeof inner === 'string' ? inner.trim() : '';
    if (text) {
      reasoningSegments.push(text);
    }
    return '';
  });

  return {
    display: sanitized.trim(),
    reasoning:
      reasoningSegments.length > 0 ? reasoningSegments.join('\n\n').trim() : undefined,
  };
};

const serializeContent = (value: unknown, forceReasoning = false): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return forceReasoning ? `<think>${value}</think>` : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeContent(item, forceReasoning)).join('');
  }

  if (typeof value === 'object') {
    const part = value as Record<string, unknown>;
    const type = typeof part.type === 'string' ? (part.type as string).toLowerCase() : '';
    const isReasoningType = forceReasoning || REASONING_TYPES.has(type);

    if ('text' in part && typeof part.text === 'string') {
      return isReasoningType ? `<think>${part.text}</think>` : (part.text as string);
    }

    if ('value' in part && typeof part.value === 'string') {
      return isReasoningType ? `<think>${part.value}</think>` : (part.value as string);
    }

    if ('reasoning' in part) {
      const nested = serializeContent(part.reasoning, true);
      if (nested) {
        return nested;
      }
    }

    if ('content' in part) {
      const nested = serializeContent(part.content, isReasoningType);
      if (nested) {
        return nested;
      }
    }

    if ('message' in part) {
      const nested = serializeContent(part.message, isReasoningType);
      if (nested) {
        return nested;
      }
    }

    if ('arguments' in part && typeof part.arguments === 'string') {
      return part.arguments as string;
    }

    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    return forceReasoning ? `<think>${text}</think>` : text;
  }

  return '';
};

export const parseAssistantContent = (
  content: unknown,
  reasoningField?: unknown,
): ParsedAssistantContent => {
  let rawContent = serializeContent(content);
  const { display: baseDisplay, reasoning: baseReasoning } = stripThinkingTags(rawContent);

  let display = baseDisplay;
  const reasoningSegments: string[] = [];
  if (baseReasoning) {
    reasoningSegments.push(baseReasoning);
  }

  let reasoningRaw = serializeContent(reasoningField);
  if (reasoningRaw) {
    const { display: fallbackDisplay, reasoning: fallbackReasoning } = stripThinkingTags(reasoningRaw);
    if (fallbackReasoning) {
      reasoningSegments.push(fallbackReasoning);
    }
    if (!display && fallbackDisplay) {
      display = fallbackDisplay;
    }
    if (!rawContent) {
      rawContent = reasoningRaw;
    }
  }

  if (!display && rawContent) {
    display = rawContent.trim();
  }

  const distinctReasoning = Array.from(
    new Set(
      reasoningSegments
        .flatMap((segment) => segment.split('\n\n'))
        .map((segment) => segment.trim())
        .filter(Boolean),
    ),
  );

  if (display) {
    let cleanedDisplay = display;
    distinctReasoning.forEach((segment) => {
      if (!segment) return;
      const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      cleanedDisplay = cleanedDisplay.replace(regex, '');
    });
    cleanedDisplay = cleanedDisplay.replace(/<\/?think>/gi, '').trim();
    display = cleanedDisplay || display;
  }

  let rawForConversation = rawContent;
  const reasoningText = distinctReasoning.join('\n\n');
  if (reasoningText) {
    const hasOpeningThink = rawContent.includes('<think>');
    const hasClosingThink = rawContent.includes('</think>');
    if (!hasOpeningThink || !hasClosingThink) {
      const displaySection = display ? `\n\n${display}` : '';
      rawForConversation = `<think>${reasoningText}</think>${displaySection}`;
    }
  }

  return {
    raw: rawForConversation,
    display: display || '',
    reasoning: distinctReasoning.length ? distinctReasoning.join('\n\n') : undefined,
  };
};
