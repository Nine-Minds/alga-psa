import OpenAI from 'openai';
import { LLMClient, StreamChatCompletionParams, StreamChunk, ToolCall, ToolCallFunction } from './types';
import { LocalMessage, TextBlock, ToolResult, ToolUseBlock } from '../../types/messages';
import { ChatCompletionCreateParamsStreaming } from 'openai/resources/index.mjs';

// OpenAI message types including tool response
type OpenAIToolResponseMessage = {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name: string;
};

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam | OpenAIToolResponseMessage;

function convertToOpenAIMessage(msg: LocalMessage): OpenAIMessage[] {

  if (msg.role === 'system') {
      return [{
        role: 'system',
        content: typeof msg.content === 'string' ? msg.content : '',
      }];
  }

  if (typeof msg.content === 'string') {
      if (msg.role === 'tool') {
          if (!('tool_call_id' in msg) || !('name' in msg)) {
              throw new Error('Tool messages must include tool_call_id and name');
          }
          return [{
              role: 'tool',
              content: msg.content,
              tool_call_id: msg.tool_call_id!,
              name: msg.name
          }];
      }
      return [{
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
      } as OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam];
  }

  // For messages with tool usage, we need to format them appropriately
  if (Array.isArray(msg.content)) {
    // Handle tool results
    if (msg.content.some(block => 'tool_use_id' in block)) {
      const toolResult = msg.content.find((block): block is ToolResult => 'tool_use_id' in block);
      if (!toolResult) {
        throw new Error('Expected tool result block');
      }

      // For tool results, we only need to send the tool response
      // OpenAI maintains the context of the original tool call
      const toolContent = toolResult.content.map(c => c.text).join('\n');
      const functionName = toolResult.tool_use_id.split('_')[2] || 'unknown_tool';
      
      const toolResponse: OpenAIToolResponseMessage = {
        role: 'tool',
        content: toolContent,
        tool_call_id: toolResult.tool_use_id,
        name: functionName
      };

      return [toolResponse];
    }

    // Handle tool use
    if (msg.content.some(block => block.type === 'tool_use')) {
      const toolUseBlock = msg.content.find((block): block is ToolUseBlock => block.type === 'tool_use');
      const textBlocks = msg.content.filter((block): block is TextBlock => block.type === 'text');
      
      // For tool use, create an assistant message with the tool call
      if (!toolUseBlock) {
        return [{
          role: 'assistant',
          content: textBlocks.map(block => block.text).join('\n'),
        }];
      }

      return [{
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.map(block => block.text).join('\n') : null,
        tool_calls: [{
          id: toolUseBlock.id,
          type: 'function' as const,
          function: {
            name: toolUseBlock.name,
            arguments: JSON.stringify(toolUseBlock.input),
          }
        }],
      } as OpenAI.Chat.ChatCompletionAssistantMessageParam];
    }

    // Handle text-only messages
      return [{
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content.map(block => {
              if ('text' in block) return block.text;
              return '';
          }).join('\n'),
      } as OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam];
  }

  // Handle string content
      return [{
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
          tool_calls: msg.tool_calls || undefined,
      } as OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam];
}

// Find this function
async function* openAIStreamToChunks(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<StreamChunk> {
  const currentToolCalls: Array<{
    id: string;
    name: string;
    arguments?: string;
    parameters?: unknown;
    index: number;
    function?: ToolCallFunction;
  }> = [];

  for await (const chunk of stream) {
    

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Handle content updates
    if (delta.content) {
      yield {
        type: 'content_block_delta',
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      };
    }

    // Handle tool calls
    if (delta.tool_calls?.length) {
      for (const toolCall of delta.tool_calls) {
        let currentToolCall = currentToolCalls.find(t => t.index === toolCall.index);
        
        // Initialize tool call if this is the first chunk for this tool
        if (!currentToolCall) {
          if (!toolCall.id) {
            throw new Error('Tool call missing required ID from OpenAI');
          }

          currentToolCall = {
            id: toolCall.id,
            name: toolCall.function?.name ?? 'unknown_tool',
            arguments: toolCall.function?.arguments || '',
            parameters: (toolCall as ToolCall).parameters,
            index: toolCall.index,
            function: toolCall.function,
          };
          currentToolCalls.push(currentToolCall);

          // Get input from either parameters or arguments
          if (currentToolCall.arguments) {
            console.log('Parsing tool call arguments:', currentToolCall.arguments);
          }
          const input = currentToolCall.parameters || 
                       (currentToolCall.arguments ? 
                         (currentToolCall.arguments.trim() ? JSON.parse(currentToolCall.arguments) : {}) : 
                         {});

          // Emit tool use start with the tool call info
          yield {
            type: 'content_block_start',
            index: currentToolCall.index,
            content_block: {
              type: 'tool_use',
              id: currentToolCall.id,
              name: currentToolCall.name,
              input,
            },
          };
        } else {
          // Update existing tool call with new chunks
          if (toolCall.function?.arguments) {
            currentToolCall.arguments = (currentToolCall.arguments || '') + toolCall.function.arguments;
          }
          if ((toolCall as ToolCall).parameters) {
            currentToolCall.parameters = (toolCall as ToolCall).parameters;
          }

          if (toolCall.function?.arguments) {
            yield {
              type: 'content_block_delta',
              delta: {
                type: 'input_json_delta',
                index: currentToolCall.index,
                partial_json: toolCall.function.arguments,
              },
            };
          }
        }
      }
    }

    // Handle finish reason
    if (chunk.choices[0]?.finish_reason) {
      if (currentToolCalls.length > 0) {
        // Emit stop for each tool call
        for (const toolCall of currentToolCalls) {
          yield {
            type: 'content_block_stop',
            index: toolCall.index,
          };
        }

        // Emit message delta with all tool calls
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: 'tool_use',
            tool_calls: currentToolCalls.map(toolCall => ({
              index: toolCall.index,
              id: toolCall.id,
              type: 'function',
              parameters: toolCall.parameters || 
                         (toolCall.arguments ? 
                           (toolCall.arguments.trim() ? JSON.parse(toolCall.arguments) : {}) : 
                           {}),
              function: toolCall.function!
            })),
          },
        };
      } else {
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
          },
        };
      }
      yield {
        type: 'message_stop',
      };
    }
  }
}

export abstract class BaseOpenAIClient implements LLMClient {
  protected openai: OpenAI;

  constructor(config: ConstructorParameters<typeof OpenAI>[0]) {
    this.openai = new OpenAI(config);
  }

  public async *streamChatCompletion(
    params: StreamChatCompletionParams
  ): AsyncIterable<StreamChunk> {
    // Convert messages to OpenAI format
    const messages = [
      // Add system message first
      {
        role: 'system' as const,
        content: params.systemPrompt,
      },
      // Then add the rest of the messages
      ...params.messages.flatMap(convertToOpenAIMessage),
    ];

    // Convert tools to OpenAI tools format
    const tools = (params.tools || []).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.input_schema.properties,
          required: tool.input_schema.required,
        },
      }
    }));

    const completion: ChatCompletionCreateParamsStreaming =  {
      model: params.model,
      messages,
      tools,
      response_format: {type: 'text'},
      tool_choice: tools ? 'auto' : undefined,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.2,
      stream: true,
    };

    console.log('OpenRouter model:', params.model);
    console.log('OpenAI stream params:', JSON.stringify(completion, null, 2));

    // Create streaming request to OpenAI
    const stream = await this.openai.chat.completions.create(completion);

    try {
      // Stream the response, transforming each chunk
      for await (const chunk of openAIStreamToChunks(stream)) {
        yield chunk;
      }
    } catch (error) {
      console.log('Unexpected error in sendMessage:', JSON.stringify(error, null, 2));
      throw error;
    }
  }
}
