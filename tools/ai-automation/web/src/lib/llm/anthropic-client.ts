import { Anthropic } from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/src/resources/messages/messages.js';
import { LLMClient, StreamChatCompletionParams, StreamChunk } from './types';
import { LocalMessage, TextBlock, ToolResult, ToolUseBlock } from '../../types/messages';

function convertToAnthropicMessage(msg: LocalMessage): MessageParam {
  if (msg.role === 'system') {
    throw new Error('System messages should be handled separately');
  }
  
  if (typeof msg.content === 'string') {
    return {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    };
  }
  return {
    role: msg.role as 'user' | 'assistant',
    content: msg.content.map((block) => {
      if ('tool_use_id' in block) {
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        } as ToolResult;
      }
      if (block.type === 'tool_use') {
        return block as ToolUseBlock;
      }
      return block as TextBlock;
    }),
  };
}

export class AnthropicClient implements LLMClient {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  public async *streamChatCompletion(
    params: StreamChatCompletionParams
  ): AsyncIterable<StreamChunk> {
    const anthropicMessages = params.messages.map(convertToAnthropicMessage);

    const completion = await this.anthropic.messages.create({
      model: params.model,
      system: params.systemPrompt,
      messages: anthropicMessages,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.2,
      tools: params.tools,
      stream: true,
    });

    for await (const chunk of completion) {
      yield chunk as StreamChunk;
    }
  }
}
