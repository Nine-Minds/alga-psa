import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import { prompts } from '../../../tools/prompts';
import {
  observeBrowser,
  executeScript,
  wait,
  executePuppeteerScript,
  getUIState
} from '../../../tools/invokeTool';
import { getLLMClient, mapModelName } from '../../../lib/llm/factory';
import { StreamChatCompletionParams } from '../../../lib/llm/types';
import { LocalMessage } from '../../../types/messages';

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'executing' | 'complete';
}

// Message content block for tool use without status
interface MessageToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Message content block for text
interface MessageTextBlock {
  type: 'text';
  text: string;
}

type ToolName = 'observe_browser' | 'execute_script' | 'wait' | 'execute_puppeteer_script' | 'get_ui_state';

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

type StreamEventType = 'token' | 'tool_use' | 'tool_result' | 'error' | 'done';

interface StreamEvent {
  type: StreamEventType;
  data: string;
}

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

type UIStateParams = Record<never, never>;

type ToolInput = ObserverParams | ExecuteScriptParams | WaitParams | PuppeteerScriptParams | UIStateParams;

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
    } else if (name === ('get_ui_state' as ToolName)) {
      result = await getUIState();
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
    const MAX_LENGTH = 5000;
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

async function handleAIRequest(rawMessages: LocalMessage[]) {
  // Extract system message and filter other messages
  let systemMessage = '';
  const initialMessages = rawMessages.filter(msg => {
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
        const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(textEncoder.encode(payload));
      }

      // Get the LLM client
      const provider = (process.env.LLM_PROVIDER as 'anthropic' | 'openai') || 'anthropic';
      const client = getLLMClient();

      // We may repeat calls until the model stops requesting a tool
      while (true) {
        let toolUseBlock: ToolUseBlock | null = null;
        let currentText = '';
        let currentInput = '';
        let toolCallId: string = '';
        let stopReason: string | undefined | null;

        // Stream the completion using our LLM client
        const params: StreamChatCompletionParams = {
          model: mapModelName(provider, 'gpt-4-turbo'),
          systemPrompt: systemMessage || prompts.aiEndpoint,
          messages: currentMessages,
          tools,
          maxTokens: 1024,
          temperature: 0.2,
        };
        
        try {
          const completion = client.streamChatCompletion(params);
          for await (const streamChunk of completion) {
            if (streamChunk.type === 'message_delta') {
              stopReason = streamChunk.delta.stop_reason;
            }
            
            if (streamChunk.type === 'content_block_start') {
              const contentBlock = streamChunk.content_block;
              if (contentBlock.type === 'tool_use') {
                toolUseBlock = {
                  type: 'tool_use',
                  id: contentBlock.id,
                  name: contentBlock.name,
                  input: {} as Record<string, unknown>,
                  status: 'pending'
                };
              }
            } else if (streamChunk.type === 'content_block_delta') {
              const delta = streamChunk.delta;
              
              if (delta.type === 'text_delta' && delta.text) {
                currentText += delta.text;
                sendEvent('token', delta.text);
              } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                currentInput += delta.partial_json;
                
                // Send non-empty chunks to the client
                if (delta.partial_json.trim()) {
                  sendEvent('token', delta.partial_json);
                }
              }
            } else if (streamChunk.type === 'content_block_stop') {
              // Wait for message_delta to get tool_call_id before executing
            } else if (streamChunk.type === 'message_delta') {
              if (streamChunk.delta.tool_calls?.[0]) {
                const toolCall = streamChunk.delta.tool_calls[0];
                toolCallId = toolCall.id;
                
                if (toolUseBlock && currentInput) {
                  try {
                    // Parse and validate input
                    const inputObject = JSON.parse(currentInput);
                    if (typeof inputObject === 'object' && inputObject !== null) {
                      // Update tool block with validated input
                      toolUseBlock.input = inputObject;
                      toolUseBlock.id = toolCallId;
                      toolUseBlock.status = 'executing';
                      
                      // Add assistant message with tool call first
                      const messageToolUse: MessageToolUseBlock = {
                        type: 'tool_use',
                        id: toolCallId,
                        name: toolUseBlock.name,
                        input: toolUseBlock.input
                      };
                      const assistantMessage: LocalMessage = {
                        role: 'assistant',
                        content: [messageToolUse],
                      };
                      currentMessages.push(assistantMessage);
                      
                      console.log('Tool use request:', JSON.stringify(toolUseBlock, null, 2));
                      sendEvent('tool_use', JSON.stringify(toolUseBlock));

                      // Execute tool after we have the tool_call_id
                      const result = await executeToolAndGetResult(toolUseBlock);
                      console.log('Tool execution result:', result);
                      sendEvent('tool_result', result);

                      // Add tool result message that responds to the tool call
                      currentMessages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: toolCallId,
                        name: toolUseBlock.name
                      });
                      
                      toolUseBlock.status = 'complete';
                    }
                  } catch (error) {
                    console.error('Failed to process tool input:', {
                      error,
                      input: currentInput
                    });
                  }
                }
              }
            }
          }
        
          // Push an "assistant" message with any accumulated text content
          if (currentText) {
            const textBlock: MessageTextBlock = { type: 'text', text: currentText };
            const assistantMessage: LocalMessage = {
              role: 'assistant',
              content: [textBlock],
            };
            currentMessages.push(assistantMessage);
            console.log('Assistant response:', JSON.stringify(assistantMessage, null, 2));
          }

          // Handle different stop reasons
          if (stopReason === 'tool_use') {
            // Continue for tool use
            continue;
          } else {
            // Normal completion or other stop reasons
            break;
          }
        } catch (error) {
          // Type guard for OpenAI API errors
          interface OpenAIError {
            status?: number;
            code?: number;
            message?: string;
            error?: {
              metadata?: unknown;
            };
          }

          const isOpenAIError = (err: unknown): err is OpenAIError => {
            return typeof err === 'object' && err !== null && 
              ('status' in err || 'code' in err || 'message' in err || 'error' in err);
          };

          const providerError = isOpenAIError(error) ? {
            status: error.status,
            code: error.code,
            message: error.message,
            metadata: error.error?.metadata
          } : {
            message: error instanceof Error ? error.message : String(error)
          };

          console.error('Provider error:', providerError);
          
          // Send error to client
          sendEvent('error', `Provider error: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
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
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('User request:', JSON.stringify(body, null, 2));
    return handleAIRequest(body.messages);
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

// Keep GET for backward compatibility
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const messagesParam = url.searchParams.get('messages');
    if (!messagesParam) {
      throw new Error('No messages provided');
    }
    const rawMessages = JSON.parse(messagesParam);
    console.log('User request:', JSON.stringify(rawMessages, null, 2));
    return handleAIRequest(rawMessages);
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
