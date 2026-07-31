import { parseJsonInteger, requireObject } from './input.js';

export interface CapturedUsage {
  promptTokens: bigint;
  completionTokens: bigint;
  totalTokens: bigint;
}

export function readUsageFromPayload(payload: unknown): CapturedUsage | undefined {
  const root = requireObject(payload, 'provider payload');
  if (root.usage === undefined || root.usage === null) {
    return undefined;
  }
  const usage = requireObject(root.usage, 'provider usage');
  const promptValue = usage.prompt_tokens ?? usage.input_tokens;
  const completionValue = usage.completion_tokens ?? usage.output_tokens;
  if (promptValue === undefined || completionValue === undefined) {
    throw new Error('Provider usage is missing prompt or completion tokens');
  }
  const promptTokens = parseJsonInteger(promptValue, 'provider usage prompt tokens');
  const completionTokens = parseJsonInteger(
    completionValue,
    'provider usage completion tokens',
  );
  const totalTokens =
    usage.total_tokens === undefined
      ? promptTokens + completionTokens
      : parseJsonInteger(usage.total_tokens, 'provider usage total tokens');
  if (promptTokens < 0n || completionTokens < 0n || totalTokens < 0n) {
    throw new Error('Provider usage tokens must be non-negative');
  }
  if (totalTokens !== promptTokens + completionTokens) {
    throw new Error('Provider total tokens do not equal prompt plus completion tokens');
  }
  return { promptTokens, completionTokens, totalTokens };
}

export class StreamingUsageCapture {
  private readonly decoder = new TextDecoder();
  private textBuffer = '';
  private capturedUsage: CapturedUsage | undefined;

  push(chunk: Uint8Array): void {
    this.textBuffer += this.decoder.decode(chunk, { stream: true });
    this.processCompleteLines();
  }

  finish(): CapturedUsage | undefined {
    this.textBuffer += this.decoder.decode();
    this.processCompleteLines(true);
    return this.capturedUsage;
  }

  private processCompleteLines(flush = false): void {
    const lines = this.textBuffer.split('\n');
    this.textBuffer = flush ? '' : (lines.pop() ?? '');
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data:')) {
        continue;
      }
      const data = line.slice(5).trimStart();
      if (!data || data === '[DONE]') {
        continue;
      }
      try {
        const usage = readUsageFromPayload(JSON.parse(data) as unknown);
        if (usage) {
          this.capturedUsage = usage;
        }
      } catch (error) {
        console.warn('[ai-gateway] Ignoring malformed upstream SSE data line', error);
      }
    }

    if (flush && this.textBuffer) {
      this.processCompleteLines();
    }
  }
}
