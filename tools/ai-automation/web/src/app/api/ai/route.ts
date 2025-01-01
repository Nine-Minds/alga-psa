import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import { prompts } from '../../../tools/prompts';
import {
  observeBrowser,
  executeScript,
  wait,
  executePuppeteerScript,
  getUIState,
} from '../../../tools/invokeTool';
import { getLLMClient } from '../../../lib/llm/factory';
import { StreamChatCompletionParams } from '../../../lib/llm/types';
import { LocalMessage } from '../../../types/messages';
import {
  StreamChunk,
  MessageDeltaChunk,
  ToolCall
} from '../../../lib/llm/types';


// ------------------- Types & Interfaces -------------------

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  index: number;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'executing' | 'complete';
}

interface MessageTextBlock {
  type: 'text';
  text: string;
}

function isMessageDeltaChunk(chunk: StreamChunk): chunk is MessageDeltaChunk {
  return chunk.type === 'message_delta';
}

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

type StreamEventType = 'token' | 'tool_result' | 'error' | 'done';

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
type ToolInput =
  | ObserverParams
  | ExecuteScriptParams
  | WaitParams
  | PuppeteerScriptParams
  | UIStateParams;

// interface StreamToolCall {
//   id: string;
//   index: number;
//   type: 'function';
//   function: {
//     name: string;
//     arguments: string;
//   };
// }

// ------------------- Tool Execution -------------------

async function executeToolAndGetResult(toolBlock: ToolUseBlock): Promise<string> {
  const { name, input } = toolBlock;
  const toolInput = input as unknown as ToolInput;

  try {
    let result: ToolExecutionResult;
    if (name === 'observe_browser') {
      const params = toolInput as ObserverParams;
      result = await observeBrowser(params.selector);
    } else if (name === 'execute_script') {
      const params = toolInput as ExecuteScriptParams;
      result = await executeScript(params.code);
    } else if (name === 'wait') {
      const params = toolInput as WaitParams;
      result = await wait(params.seconds);
    } else if (name === 'execute_puppeteer_script') {
      const params = toolInput as PuppeteerScriptParams;
      result = await executePuppeteerScript(params.script);
    } else if (name === 'get_ui_state') {
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
    return `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)
      }`;
  }
}

// ------------------- Finite State Machine -------------------

// Possible states for our streaming logic
type StreamingState = 'INIT' | 'READING_STREAM' | 'TOOL_REQUESTED' | 'TOOL_EXECUTING' | 'DONE';

// Type guard for state transitions
function isValidStateTransition(state: string): state is StreamingState {
  return ['INIT', 'READING_STREAM', 'TOOL_REQUESTED', 'TOOL_EXECUTING', 'DONE'].includes(state);
}

// Helper function to safely transition states
function transitionState(currentState: StreamingState, nextState: string): StreamingState {
  if (isValidStateTransition(nextState)) {
    return nextState;
  }
  return currentState;
}

interface StateContext {
  // Data we collect or need to pass around between states
  rawMessages: LocalMessage[];
  systemMessage: string;
  currentMessages: LocalMessage[];

  toolUseBlocks: Map<number, ToolUseBlock>; // Change to Map to track multiple tools
  currentText: string;
  currentInput: string;
  currentToolIndex: number | null; // Track current tool index
  toolCallId: string;
  stopReason: string | null;
  accumulatedInput: string; // Add this to track accumulated JSON chunks

  // SSE controller
  controller: ReadableStreamDefaultController<Uint8Array>;

  // A function to send SSE events
  sendEvent: (eventName: StreamEventType, data: string) => void;
}

function toolRequiresArguments(toolName: string): boolean {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) return true; // Default to requiring arguments if tool not found (safer)

  // Check if the tool has any required parameters or any properties defined
  const hasRequired = Array.isArray(tool.input_schema.required) &&
    tool.input_schema.required.length > 0;
  const hasProperties = Object.keys(tool.input_schema.properties).length > 0;

  return hasRequired || hasProperties;
}

// ------------------- Main Handler Logic -------------------

async function handleAIRequest(rawMessages: LocalMessage[]) {
  let systemMessage = '';
  const initialMessages = rawMessages.filter((msg) => {
    if (msg.role === 'system') {
      systemMessage = typeof msg.content === 'string' ? msg.content : '';
      return false;
    }
    return true;
  });

  // Prepare streaming response
  const textEncoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      // Utility for sending SSE events
      function sendEvent(type: StreamEventType, data: string) {
        const event: StreamEvent = { type, data };
        const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(textEncoder.encode(payload));
      }

      // Prepare context
      const ctx: StateContext = {
        rawMessages,
        systemMessage,
        currentMessages: [...initialMessages],

        toolUseBlocks: new Map(), // Initialize Map for multiple tools
        currentText: '',
        currentInput: '',
        currentToolIndex: null,
        toolCallId: '',
        stopReason: null,
        accumulatedInput: '', // Initialize accumulated input

        controller,
        sendEvent,
      };

      // Finite State Machine
      let currentState: StreamingState = 'INIT';
      const client = getLLMClient();

      // We'll store the async generator for the LLM stream
      let completionStream: AsyncIterable<StreamChunk> | null = null;

      // We loop until currentState = 'DONE'
      messageProcessing: while (currentState !== 'DONE') {
        console.log('currentState:', currentState);
        switch (currentState) {
          case 'INIT': {
            // Initialize the streaming request to the LLM
            const params: StreamChatCompletionParams = {
              model: process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini',
              systemPrompt: ctx.systemMessage || prompts.aiEndpoint,
              messages: ctx.currentMessages,
              tools,
              maxTokens: 1024,
              temperature: 0.2,
            };

            try {
              completionStream = client.streamChatCompletion(params);
              currentState = transitionState(currentState, 'READING_STREAM');
            } catch (error) {
              ctx.sendEvent('error', `Provider error: ${String(error)}`);
              currentState = transitionState(currentState, 'DONE');
            }
            break;
          }

          case 'READING_STREAM': {
            if (!completionStream) {
              currentState = transitionState(currentState, 'DONE');
              break;
            }
          
            let hasContent = false;
            for await (const streamChunk of completionStream) {
              console.log('Processing stream chunk:', {
                type: streamChunk.type,
                state: currentState,
                toolIndex: ctx.currentToolIndex,
                toolCallId: ctx.toolCallId,
              });
          
              // Handle content deltas
              if (streamChunk.type === 'content_block_delta') {
                if (streamChunk.delta.type === 'text_delta' && streamChunk.delta.text) {
                  ctx.currentText += streamChunk.delta.text;
                  ctx.sendEvent('token', streamChunk.delta.text);
                  hasContent = true;
                } else if (streamChunk.delta.type === 'input_json_delta' && streamChunk.delta.partial_json) {
                  // Accumulate JSON chunks
                  ctx.accumulatedInput += streamChunk.delta.partial_json;
                }
                continue;
              }
          
              if (isMessageDeltaChunk(streamChunk)) {
                const toolCalls = streamChunk.delta.tool_calls;
                if (toolCalls && toolCalls.length > 0) {
                  const toolCall = toolCalls[0] as unknown as ToolCall;
                  console.log('Raw tool call:', JSON.stringify(toolCall, null, 2));
          
                  // Handle new tool call
                  if (toolCall.id && (!ctx.currentToolIndex || !ctx.toolCallId)) {
                    const toolName = toolCall.function.name;
                    if (toolName) {
                      console.log('Processing new tool call:', {
                        name: toolName,
                        id: toolCall.id,
                        index: toolCall.index
                      });
          
                      const toolBlock: ToolUseBlock = {
                        type: 'tool_use',
                        id: toolCall.id,
                        index: toolCall.index,
                        name: toolName,
                        input: {},
                        status: 'pending'
                      };
                      ctx.toolUseBlocks.set(toolCall.index, toolBlock);
                      ctx.currentToolIndex = toolCall.index;
                      ctx.toolCallId = toolCall.id;
                      ctx.accumulatedInput = ''; // Reset accumulated input for new tool
                    }
                  }
          
                  // Accumulate function arguments
                  if (toolCall.function?.arguments) {
                    ctx.accumulatedInput += toolCall.function.arguments;
                  }

                  if (toolCall.parameters) {
                    ctx.accumulatedInput += JSON.stringify(toolCall.parameters);
                    currentState = transitionState(currentState, 'TOOL_REQUESTED');
                    continue messageProcessing;
                  }
          
                  // If this is a no-argument tool, execute immediately
                  const currentTool = ctx.currentToolIndex !== null ? ctx.toolUseBlocks.get(ctx.currentToolIndex) : null;
                  if (currentTool && !toolRequiresArguments(currentTool.name)) {
                    console.log('Executing no-argument tool:', currentTool.name);
                    currentState = transitionState(currentState, 'TOOL_REQUESTED');
                    continue messageProcessing;
                  }
                }
          
                // Handle finish conditions
                if (streamChunk.delta.finish_reason === 'tool_calls' ||
                    streamChunk.delta.stop_reason === 'tool_use') {
                  console.log('Tool calls finish reason, accumulated input:', {
                    currentToolIndex: ctx.currentToolIndex,
                    hasToolBlock: ctx.currentToolIndex !== null && ctx.toolUseBlocks.has(ctx.currentToolIndex),
                    accumulatedInput: ctx.accumulatedInput
                  });
          
                  if (ctx.currentToolIndex !== null && ctx.accumulatedInput) {
                    const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex);
                    if (currentTool) {
                      try {
                        // Parse accumulated JSON and store in tool block
                        const inputObject = JSON.parse(ctx.accumulatedInput);
                        currentTool.input = inputObject;
                        console.log('Parsed tool input:', inputObject);
                        currentState = transitionState(currentState, 'TOOL_REQUESTED');
                        continue messageProcessing;
                      } catch (err) {
                        console.error('Failed to parse tool input JSON:', {
                          err,
                          input: ctx.accumulatedInput
                        });
                        // Handle JSON parse error
                        ctx.sendEvent('error', `Failed to parse tool input: ${String(err)}`);
                        currentState = transitionState(currentState, 'DONE');
                        continue messageProcessing;
                      }
                    }
                  }
                }
          
                if (streamChunk.delta.finish_reason === 'stop' ||
                    streamChunk.delta.stop_reason === 'end_turn') {
                  // Save any remaining text content before finishing
                  if (hasContent) {
                    const textBlock: MessageTextBlock = {
                      type: 'text',
                      text: ctx.currentText,
                    };
                    ctx.currentMessages.push({
                      role: 'assistant',
                      content: [textBlock],
                    });
                    ctx.currentText = '';
                  }
                  currentState = transitionState(currentState, 'DONE');
                  continue messageProcessing;
                }
              }
            }
          
            // If we exit the for-await loop normally
            if (currentState === 'READING_STREAM') {
              if (hasContent) {
                const textBlock: MessageTextBlock = {
                  type: 'text',
                  text: ctx.currentText,
                };
                ctx.currentMessages.push({
                  role: 'assistant',
                  content: [textBlock],
                });
                ctx.currentText = '';
              }
              currentState = transitionState(currentState, 'DONE');
            }
            break;
          }

          case 'TOOL_REQUESTED': {
            // We have a tool block that we want to execute
            if (ctx.currentToolIndex === null || !ctx.toolUseBlocks.has(ctx.currentToolIndex)) {
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Validate JSON
            const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex)!;
            try {
              const inputObject = ctx.accumulatedInput.trim() === '' ? {} : JSON.parse(ctx.accumulatedInput);
              currentTool.input = inputObject;
              currentTool.id = ctx.toolCallId;
              currentTool.status = 'executing';
            } catch (err) {
              console.error('Failed to parse tool input JSON:', {
                err,
                input: ctx.accumulatedInput,
              });
              currentTool.status = 'complete';
              ctx.toolUseBlocks.delete(ctx.currentToolIndex);
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Add assistant message with the tool call
            const assistantMessage: LocalMessage = {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: ctx.toolCallId,
                  type: 'function',
                  function: {
                    name: currentTool.name,
                    arguments: JSON.stringify(currentTool.input),
                  },
                },
              ],
            };
            ctx.currentMessages.push(assistantMessage);

            // Transition to the next state
            currentState = transitionState(currentState, 'TOOL_EXECUTING');
            break;
          }

          case 'TOOL_REQUESTED': {
            // We have a tool block that we want to execute
            if (ctx.currentToolIndex === null || !ctx.toolUseBlocks.has(ctx.currentToolIndex)) {
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Validate JSON
            const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex)!;
            try {
              const inputObject = ctx.currentInput.trim() === '' ? {} : JSON.parse(ctx.currentInput);
              currentTool.input = inputObject;
              currentTool.id = ctx.toolCallId;
              currentTool.status = 'executing';
            } catch (err) {
              console.error('Failed to parse tool input JSON:', {
                err,
                input: ctx.accumulatedInput,
              });
              currentTool.status = 'complete';
              ctx.toolUseBlocks.delete(ctx.currentToolIndex);
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Add assistant message with the tool call
            const assistantMessage: LocalMessage = {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: ctx.toolCallId,
                  type: 'function',
                  function: {
                    name: currentTool.name,
                    arguments: JSON.stringify(currentTool.input),
                  },
                },
              ],
            };
            ctx.currentMessages.push(assistantMessage);

            // Transition to the next state
            currentState = transitionState(currentState, 'TOOL_EXECUTING');
            break;
          }
          case 'TOOL_EXECUTING': {
            if (ctx.currentToolIndex === null || !ctx.toolUseBlocks.has(ctx.currentToolIndex)) {
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex)!;
            try {
              const result = await executeToolAndGetResult(currentTool);
              console.log('Tool execution result:', result);
              ctx.sendEvent('tool_result', result);

              ctx.currentMessages.push({
                role: 'tool',
                content: result,
                tool_call_id: ctx.toolCallId,
                name: currentTool.name,
              });
            } catch (error) {
              console.error('Failed to execute tool:', error);
              ctx.sendEvent('error', `Failed to execute tool: ${String(error)}`);
            }

            // Mark tool done, reset fields
            currentTool.status = 'complete';
            ctx.toolUseBlocks.delete(ctx.currentToolIndex);
            ctx.currentToolIndex = null;
            ctx.currentInput = '';
            ctx.accumulatedInput = ''; // Reset accumulated input
            ctx.toolCallId = '';

            // Create new stream with updated context
            const params: StreamChatCompletionParams = {
              model: process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini',
              systemPrompt: ctx.systemMessage || prompts.aiEndpoint,
              messages: ctx.currentMessages,
              tools,
              maxTokens: 1024,
              temperature: 0.2,
            };

            try {
              // Close existing stream if it exists
              if (completionStream) {
                const iterator = completionStream[Symbol.asyncIterator]();
                if (iterator.return) {
                  await iterator.return();
                }
              }

              // Reset ALL accumulation state before transitioning
              ctx.currentText = '';
              ctx.currentInput = '';  // Reset accumulated input
              ctx.toolCallId = '';
              if (ctx.currentToolIndex !== null) {
                ctx.toolUseBlocks.delete(ctx.currentToolIndex);
              }

              ctx.currentToolIndex = null;

              // Create new stream with updated context
              completionStream = client.streamChatCompletion(params);
              currentState = transitionState(currentState, 'READING_STREAM');
            } catch (error) {
              console.error('Failed to create new stream:', error);
              ctx.sendEvent('error', `Failed to create new stream: ${String(error)}`);
              currentState = transitionState(currentState, 'DONE');
            }
            break;
          }
        } // end switch
      } // end while

      // If we got here, we're done streaming
      ctx.sendEvent('done', 'true');
      ctx.controller.close();
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

// ------------------- Exported Route Handlers -------------------

export async function POST(req: Request) {
  try {
    console.log('POST request received');
    const body = await req.json();
    return handleAIRequest(body.messages);
  } catch (error) {
    console.error('Error in AI processing:', error);
    return NextResponse.json(
      {
        reply: `Error processing request: ${error instanceof Error ? error.message : String(error)
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
    return handleAIRequest(rawMessages);
  } catch (error) {
    console.error('Error in AI processing:', error);
    return NextResponse.json(
      {
        reply: `Error processing request: ${error instanceof Error ? error.message : String(error)
          }`,
      },
      { status: 500 }
    );
  }
}
