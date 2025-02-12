import { ChatModelInterface, ChatMessage } from '../interfaces/ChatModelInterface';
import Anthropic from '@anthropic-ai/sdk';
import { write } from 'fs';

interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  delta: {
    type: 'text_delta';
    text: string;
  };
}

interface ContentBlockStartEvent {
  type: 'content_block_start';
  content_block: {
    type: 'tool_use';
    name: string;
    input: any;
    id: string;
  };
}

type RawMessageStreamEvent = ContentBlockDeltaEvent | ContentBlockStartEvent;

interface ToolUse {
  type: 'tool_use';
  name: string;
  input: any;
  id: string;
}

export class AnthropicChatModel implements ChatModelInterface {
  private anthropic: Anthropic;
  private model: string;
  private functions: Tool[] = [];
  private requiresFunction: boolean = false;

  constructor(apiKey: string = '', model: string = 'claude-3-5-sonnet-20241022') {
    this.anthropic = new Anthropic({
      apiKey: apiKey || 'dummy-key'  // Use dummy key if none provided
    });
    this.model = model;
  }

  defineFunctions(functions: any[]): void {
    // Convert provided functions to Anthropic Tool format
    this.functions = functions.map(fn => ({
      name: fn.name,
      description: fn.description,
      input_schema: {
        type: 'object',
        properties: fn.parameters.properties || {},
        required: fn.parameters.required || []
      }
    }));
  }

  async sendMessage(messages: ChatMessage[]): Promise<any> {
    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        })),
        tools: this.functions.length > 0 ? this.functions : undefined
      });

      // Extract text from the first content block
      const responseText = response.content[0].type === 'text' 
        ? response.content[0].text 
        : "I don't have an answer at this time.";

      return { text: responseText };
    } catch (error) {
      console.error('Error in Anthropic chat:', error);
      return { 
        text: "I don't have an answer at this time. Please try again later.",
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async streamMessage(
    messages: ChatMessage[],
    onTokenReceived: (token: string) => void,
    options?: {
      selectedAccount?: string;
      userId?: string;
      auth_token?: string;
      chatId?: string;
      messageCount?: number;
      abortController?: AbortController;
    }
  ): Promise<void> {
    try {
      const stream = await this.anthropic.messages.stream({
        model: this.model,
        max_tokens: 4096,
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })),
        tools: this.functions.length > 0 ? this.functions : undefined
      });

      let accumulatedText = '';
      let tool = '';

      for await (const event of stream) {
        if (options?.abortController?.signal.aborted) {
          onTokenReceived('[DONE]');
          break;
        }

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            tool = JSON.stringify({
              type: 'tool_use',
              tool: {
                name: block.name,
                input: block.input,
                id: block.id
              }
            });
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            onTokenReceived(delta.text);
            accumulatedText += delta.text;
          }
        }
      }
      
      if ((await stream.finalMessage()).stop_reason === 'tool_use') {
        onTokenReceived(tool);
        this.requiresFunction = true;
        // Don't close the stream here as there are functions to be called
        return;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        onTokenReceived("Response generation was stopped.");
      } else {
        onTokenReceived("I don't have an answer at this time. Please try again later.");
        console.error('Error in chat stream:', error);
      }
    }
    finally {
      if (!this.requiresFunction) {
        onTokenReceived('[DONE]');
      }
    }
  }
}
