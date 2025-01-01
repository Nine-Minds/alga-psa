type Role = 'user' | 'assistant' | 'tool';
type SystemRole = 'system';
export type AnyRole = Role | SystemRole;

export interface ToolMessage {
  role: Extract<Role, 'tool'>;
  content: string;
  tool_call_id: string;
  name: string;
}

type BlockType = 'text' | 'tool_use' | 'tool_result';

export interface TextBlock {
  type: Extract<BlockType, 'text'>;
  text: string;
}

export interface ToolUseBlock {
  type: Extract<BlockType, 'tool_use'>;
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  type: Extract<BlockType, 'tool_result'>;
  tool_use_id: string;
  content: TextBlock[];
  is_error: boolean;
}

export type LocalMessage = ToolMessage | {
  role: Exclude<AnyRole, 'tool'>;
  content: string | (TextBlock | ToolResult | ToolUseBlock)[];
};
