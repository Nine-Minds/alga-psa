type StreamFunctionMetadata = {
  id: string;
  displayName: string;
  description?: string;
  rbacResource?: string;
  approvalRequired: boolean;
  playbooks?: string[];
  examples?: unknown[];
  arguments: Record<string, unknown>;
};

type StreamFunctionCallInfo = {
  name: string;
  arguments: Record<string, unknown>;
  toolCallId?: string;
  entryId?: string;
};

type StreamFunctionProposalPayload = {
  type: 'function_proposed';
  function: StreamFunctionMetadata;
  assistantPreview: string;
  assistantReasoning?: string;
  functionCall: StreamFunctionCallInfo;
  nextMessages: Array<Record<string, unknown>>;
  modelMessages?: Array<Record<string, unknown>>;
};

export type SseFunctionProposal = StreamFunctionProposalPayload;

type StreamEventPayload = {
  type?: unknown;
  delta?: unknown;
  content?: unknown;
  done?: unknown;
  function?: unknown;
  assistantPreview?: unknown;
  assistantReasoning?: unknown;
  functionCall?: unknown;
  nextMessages?: unknown;
  modelMessages?: unknown;
};

export type SseReadHandlers = {
  shouldContinue?: () => boolean;
  onToken?: (token: string, accumulated: string) => void;
  onReasoning?: (token: string, accumulated: string) => void;
  onToolCalls?: (proposal: StreamFunctionProposalPayload) => void;
  onDone?: (accumulated: string) => void;
};

export type SseReadResult = { content: string; doneReceived: boolean };

export async function readAssistantContentFromSse(
  response: Response,
  handlers: SseReadHandlers = {},
): Promise<SseReadResult> {
  if (!response.body) {
    throw new Error('Streaming response missing body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let doneReceived = false;

  const processEvent = (rawEvent: string) => {
    const lines = rawEvent.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const jsonText = line.slice('data:'.length).trim();
      if (!jsonText.length) {
        continue;
      }

      let payload: StreamEventPayload;
      try {
        payload = JSON.parse(jsonText) as StreamEventPayload;
      } catch {
        continue;
      }

      const eventType = typeof payload.type === 'string' ? payload.type : undefined;

      if (eventType === 'reasoning_delta') {
        const delta =
          typeof payload.delta === 'string'
            ? payload.delta
            : typeof payload.content === 'string'
              ? payload.content
              : '';
        if (delta.length > 0) {
          reasoning += delta;
          handlers.onReasoning?.(delta, reasoning);
        }
        continue;
      }

      if (eventType === 'function_proposed') {
        const fn = payload.function;
        const functionCall = payload.functionCall;
        const nextMessages = payload.nextMessages;
        if (
          fn &&
          typeof fn === 'object' &&
          !Array.isArray(fn) &&
          functionCall &&
          typeof functionCall === 'object' &&
          !Array.isArray(functionCall) &&
          Array.isArray(nextMessages)
        ) {
          handlers.onToolCalls?.(payload as StreamFunctionProposalPayload);
        }
        continue;
      }

      const token =
        typeof payload.delta === 'string'
          ? payload.delta
          : typeof payload.content === 'string'
            ? payload.content
            : '';
      if (token.length > 0) {
        content += token;
        handlers.onToken?.(token, content);
      }

      if (eventType === 'done' || payload.done === true) {
        doneReceived = true;
        handlers.onDone?.(content);
        return true;
      }
    }

    return false;
  };

  while (true) {
    if (handlers.shouldContinue && !handlers.shouldContinue()) {
      await reader.cancel();
      break;
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      if (processEvent(rawEvent)) {
        return { content, doneReceived };
      }
      boundaryIndex = buffer.indexOf('\n\n');
    }
  }

  if (buffer.length > 0) {
    processEvent(buffer);
  }

  return { content, doneReceived };
}
