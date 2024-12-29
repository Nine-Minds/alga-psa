import { Anthropic } from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/src/resources/messages/messages.js';

import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import { prompts } from '../../../tools/prompts';
import {
  observeBrowser,
  executeScript,
  wait,
  executePuppeteerScript
} from '../../../tools/invokeTool';

type Role = 'user' | 'assistant';
type SystemRole = 'system';
type AnyRole = Role | SystemRole;

type ToolName = 'observe_browser' | 'execute_script' | 'wait' | 'execute_puppeteer_script';

interface ToolExecutionResult {
  error?: string;
  success?: boolean;
  result?: {
    url?: string;
    title?: string;
    elements?: unknown[];
    [key: string]: unknown;
  };
}

type ChunkType = 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';

interface ContentBlockStartChunk {
  type: Extract<ChunkType, 'content_block_start'>;
  index: number;
  content_block: {
    type: string;
    id: string;
    name: string;
    input: unknown;
  };
}

interface ContentBlockChunk {
  type: Extract<ChunkType, 'content_block_delta'>;
  delta: ContentBlockDelta;
}

interface ContentBlockStopChunk {
  type: Extract<ChunkType, 'content_block_stop'>;
  index: number;
}

interface MessageDeltaChunk {
  type: Extract<ChunkType, 'message_delta'>;
  delta: ToolCallDelta;
}

interface MessageStopChunk {
  type: Extract<ChunkType, 'message_stop'>;
}

type StreamChunk = ContentBlockStartChunk | ContentBlockChunk | ContentBlockStopChunk | MessageDeltaChunk | MessageStopChunk;

type StreamEventType = 'token' | 'tool_use' | 'tool_result' | 'done';

interface StreamEvent {
  type: StreamEventType;
  data: string;
}

type DeltaType = 'text_delta' | 'input_json_delta';

interface TextDelta {
  type: Extract<DeltaType, 'text_delta'>;
  text: string;
}

interface InputJSONDelta {
  type: Extract<DeltaType, 'input_json_delta'>;
  partial_json: string;
}

type ContentBlockDelta = TextDelta | InputJSONDelta;

type BlockType = 'text' | 'tool_use' | 'tool_result';

interface TextBlock {
  type: Extract<BlockType, 'text'>;
  text: string;
}

interface ToolUseBlock {
  type: Extract<BlockType, 'tool_use'>;
  id: string;
  name: string;
  input: unknown;
}

interface ToolCall {
  id: string;
  type: string;
  parameters: unknown;
}

interface ToolResult {
  type: Extract<BlockType, 'tool_result'>;
  tool_use_id: string;
  content: TextBlock[];
  is_error: boolean;
}

type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

interface MessageDelta {
  stop_reason?: StopReason | null;
  stop_sequence?: string | null;
  tool_calls?: ToolCall[];
}

type ToolCallDelta = MessageDelta;

interface ObserverParams {
  selector: string;
}

interface ExecuteScriptParams {
  code: string;
}

interface WaitParams {
  seconds: number;
}

interface PuppeteerScriptParams {
  script: string;
}

type ToolInput = ObserverParams | ExecuteScriptParams | WaitParams | PuppeteerScriptParams;

interface LocalMessage {
  role: AnyRole;
  content: string | (TextBlock | ToolResult | ToolUseBlock)[];
}

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function executeToolAndGetResult(toolBlock: ToolUseBlock): Promise<string> {
  const { name, input } = toolBlock;
  const toolInput = input as unknown as ToolInput;

  try {
    let result: ToolExecutionResult;
    if (name === ('observe_browser' as ToolName)) {
      const params = toolInput as ObserverParams;
      result = await observeBrowser(params.selector);
    } else if (name === ('execute_script' as ToolName)) {
      const params = toolInput as ExecuteScriptParams;
      result = await executeScript(params.code);
    } else if (name === ('wait' as ToolName)) {
      const params = toolInput as WaitParams;
      result = await wait(params.seconds);
    } else if (name === ('execute_puppeteer_script' as ToolName)) {
      const params = toolInput as PuppeteerScriptParams;
      result = await executePuppeteerScript(params.script);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (result.error) {
      throw new Error(result.error);
    }
    if (result.success === false) {
      throw new Error('Tool execution failed');
    }

    let response = '';
    if (result.result) {
      response = JSON.stringify(result.result, null, 2);
    } else {
      response = JSON.stringify({}, null, 2);
    }

    // Truncate response if it's too long
    const MAX_LENGTH = 1000;
    if (response.length > MAX_LENGTH) {
      const truncated = response.slice(0, MAX_LENGTH);
      return `${truncated}\n... [Response truncated, total length: ${response.length} characters]`;
    }

    return response;
  } catch (error) {
    return `Failed to execute ${name}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const messagesParam = url.searchParams.get('messages');
    if (!messagesParam) {
      throw new Error('No messages provided');
    }
    const rawMessages = JSON.parse(messagesParam);
    console.log('User request:', JSON.stringify(rawMessages, null, 2));

    // Extract system message and filter other messages
    let systemMessage = '';
    const initialMessages = (rawMessages as LocalMessage[]).filter(msg => {
      if (msg.role === 'system') {
        systemMessage = typeof msg.content === 'string' ? msg.content : '';
        return false;
      }
      return true;
    });

    const currentMessages: LocalMessage[] = [...initialMessages];
    const textEncoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        // Helper to send a chunk over SSE
        function sendEvent(eventName: string, data: string) {
          const event: StreamEvent = { type: eventName as StreamEventType, data };
          const payload = `event: ${event.type}\ndata: ${event.data}\n\n`;
          controller.enqueue(textEncoder.encode(payload));
        }

        // We may repeat calls until the model stops requesting a tool
        while (true) {
          const anthropicMessages = currentMessages.map(convertToAnthropicMessage);

          let toolUseBlock: ToolUseBlock | null = null;
          let currentText = '';
          let currentInput = '';
          let lastMessageDelta: ToolCallDelta | null = null;

          const completion = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            system: systemMessage || prompts.aiEndpoint,
            messages: anthropicMessages,
            tools,
            max_tokens: 1024,
            temperature: 0.2,
            stream: true,
          });

          for await (const chunk of completion) {
            const streamChunk = chunk as StreamChunk;
            
            if (streamChunk.type === 'content_block_start') {
              const contentBlock = streamChunk.content_block;
              if (contentBlock.type === 'tool_use') {
                toolUseBlock = {
                  type: 'tool_use',
                  id: contentBlock.id,
                  name: contentBlock.name,
                  input: contentBlock.input
                } as ToolUseBlock;
              }
            } else if (streamChunk.type === 'content_block_delta') {
              const delta = streamChunk.delta;
              
              if (delta.type === 'text_delta') {
                currentText += delta.text;
                sendEvent('token', delta.text);
              } else if (delta.type === 'input_json_delta' && 'partial_json' in delta) {
                currentInput += delta.partial_json;
                sendEvent('token', delta.partial_json);
              }
            } else if (streamChunk.type === 'content_block_stop') {
              if (toolUseBlock && currentInput) {
                try {
                  const parsedInput = JSON.parse(currentInput);
                  toolUseBlock.input = parsedInput;
                } catch (error) {
                  console.error('Failed to parse tool input:', error);
                }
              }
              if (toolUseBlock) {
                console.log('Tool use request:', JSON.stringify(toolUseBlock, null, 2));
                sendEvent('tool_use', JSON.stringify(toolUseBlock));
              }
            } else if (streamChunk.type === 'message_delta') {
              lastMessageDelta = streamChunk.delta;
            }
          }
          
          // Push an "assistant" message with the accumulated content and tool use if present
          const messageContent: (TextBlock | ToolUseBlock)[] = [];
          if (currentText) {
            messageContent.push({ type: 'text', text: currentText } as TextBlock);
          }
          if (toolUseBlock) {
            messageContent.push(toolUseBlock);
          }
          const assistantMessage: LocalMessage = {
            role: 'assistant',
            content: messageContent,
          };
          currentMessages.push(assistantMessage);
          console.log('Assistant response:', JSON.stringify(assistantMessage, null, 2));

          // If we have a tool use block and the stop reason is tool_use, execute the tool and continue
          if (toolUseBlock && lastMessageDelta?.stop_reason === 'tool_use') {
            const result = await executeToolAndGetResult(toolUseBlock);
            console.log('Tool use response:', result);
            sendEvent('tool_result', result);

            // Provide the result as a "user" message for the next iteration
            const toolResultMessage: LocalMessage = {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: [{ type: 'text', text: result } as TextBlock],
                  is_error: result.startsWith('Failed to execute'),
                } as ToolResult,
              ],
            };
            currentMessages.push(toolResultMessage);
            continue;
          }
          
          break;
        }

        sendEvent('done', 'true');
        controller.close();
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in AI processing:', error);
    return NextResponse.json(
      {
        reply: `Error processing request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 }
    );
  }
}
