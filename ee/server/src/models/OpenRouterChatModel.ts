import OpenAI from 'openai';
import {
  ChatModelInterface,
  ChatMessage,
  ChatResponse,
} from '@ee/interfaces/ChatModelInterface';

export class OpenRouterChatModel implements ChatModelInterface {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'anthropic/claude-3.5-sonnet') {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.model = model;
  }

  async sendMessage(messages: ChatMessage[]): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_tokens: 4096,
      });

      const rawContent = response.choices?.[0]?.message?.content ?? '';
      const text =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
          ? rawContent
              .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part === 'object' && part !== null && 'text' in part) {
                  return (part as { text?: string }).text ?? '';
                }
                return '';
              })
              .join('')
          : '';

      return { text };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown OpenRouter error';
      console.error('[OpenRouterChatModel] sendMessage failed:', error);
      return {
        text:
          "I couldn't get a response from OpenRouter right now. Please try again later.",
        error: true,
        message,
      };
    }
  }

  async streamMessage(): Promise<void> {
    throw new Error('Streaming not supported for OpenRouter');
  }
}
