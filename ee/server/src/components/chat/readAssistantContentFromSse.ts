type StreamEventPayload = { content?: unknown; done?: unknown };

export type SseReadHandlers = {
  shouldContinue?: () => boolean;
  onToken?: (token: string, accumulated: string) => void;
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

      if (typeof payload.content === 'string') {
        content += payload.content;
        handlers.onToken?.(payload.content, content);
      }
      if (payload.done === true) {
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
