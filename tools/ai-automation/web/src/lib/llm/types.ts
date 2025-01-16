import { LocalMessage } from '../../types/messages';
import { Tool } from '../../tools/toolDefinitions';

export interface StreamChatCompletionParams {
  model: string;
  systemPrompt: string;
  messages: LocalMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
}

export type ContentBlockStartChunk = {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: string;
    id: string;
    name: string;
    input: unknown;
  };
};

export type ContentBlockChunk = {
  type: 'content_block_delta';
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    index?: number;
  };
};

export type ContentBlockStopChunk = {
  type: 'content_block_stop';
  index: number;
};

export interface ToolCallFunction {
  name?: string;
  arguments?: string;
}

export interface ToolCall {
  id: string;
  index: number;
  type: 'function';
  parameters?: unknown;
  function: ToolCallFunction;
}

export type MessageDeltaChunk = {
  type: 'message_delta';
  delta: {
    content?: string;
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
    stop_sequence?: string | null;
    finish_reason?: string;
    tool_calls?: Array<{
      index: number;
      id: string;
      type: string;
      parameters: unknown;
      function: ToolCallFunction;
    }>;
  };
};

export type MessageStopChunk = {
  type: 'message_stop';
};

export type StreamChunk =
  | ContentBlockStartChunk
  | ContentBlockChunk
  | ContentBlockStopChunk
  | MessageDeltaChunk
  | MessageStopChunk;

export interface LLMClient {
  /**
   * Generic method to start a streaming chat completion.
   */
  streamChatCompletion(params: StreamChatCompletionParams): AsyncIterable<StreamChunk>;
}
