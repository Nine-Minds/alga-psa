export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  name?: string;  // For tool messages
  tool_call_id?: string;  // For tool messages
}

export interface ChatMessage extends Message {
  timestamp?: string;
}

// Types for handling streaming content blocks
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Separate interface for tool results to avoid type conflicts
export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: TextBlock[];
}

// Union type for all possible content block types
export type ContentBlock = TextBlock | ToolUseBlock | ToolResult;

// Local message format that can handle both string content and blocks
export interface LocalMessage {
  role: Role;
  content: string | ContentBlock[] | null;
  tool_calls?: ToolCall[];  // Added to support OpenAI format
  tool_call_id?: string;
  name?: string;
}
