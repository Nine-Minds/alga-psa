import OpenAI from 'openai';
import {
  ChatModelInterface,
  ChatMessage,
  ChatResponse,
} from '../interfaces/ChatModelInterface';
import { parseAssistantContent } from '../utils/chatContent';

export class OpenRouterChatModel implements ChatModelInterface {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = process.env.OPENROUTER_CHAT_MODEL ?? 'minimax/minimax-m2') {
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
        temperature: 1.0,
        top_p: 0.95,
      });

      const message = response.choices?.[0]?.message;
      const parsed = parseAssistantContent(
        message?.content,
        (message as any)?.reasoning,
      );

      return { text: parsed.display || parsed.raw };
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
