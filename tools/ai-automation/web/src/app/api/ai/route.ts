import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import { prompts } from '../../../tools/prompts';
import { invokeTool, ToolExecutionResult } from '../../../tools/invokeTool';
import { getLLMClient } from '../../../lib/llm/factory';
import { StreamChatCompletionParams } from '../../../lib/llm/types';
import { LocalMessage } from '../../../types/messages';
import {
  StreamChunk,
  MessageDeltaChunk,
  ToolCall
} from '../../../lib/llm/types';
import { v4 as uuidv4 } from 'uuid';


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


type StreamEventType = 'token' | 'tool_result' | 'tool_use' | 'error' | 'done';

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
    const result: ToolExecutionResult = await invokeTool(name, toolInput);

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
    const MAX_LENGTH = 4096;
    if (response.length > MAX_LENGTH) {
      const truncated = response.slice(0, MAX_LENGTH);
      return `${truncated}\n... [Response truncated, total length: ${response.length} characters]. \n\nYOU SHOULD CONSIDER FILTERING THE RESULTS WITH A JSONPATH EXPRESSION OF $.components[*].[id, type] TO SEE JUST THE COMPONENTS YOU NEED. \n\nRUN ID: ${uuidv4()}`;
    }

    return response + "\nRUN ID: " + uuidv4();
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
  accumulatedInput: (string | undefined)[]; // Add this to track accumulated JSON chunks

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
        accumulatedInput: [], // Initialize accumulated input

        controller,
        sendEvent,
      };

      ctx.systemMessage = prompts.systemMessage;

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
              systemPrompt: ctx.systemMessage,
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
              // Handle content deltas
              if (streamChunk.type === 'content_block_delta') {
                if (streamChunk.delta.type === 'text_delta' && streamChunk.delta.text) {
                  ctx.currentText += streamChunk.delta.text;
                  ctx.sendEvent('token', streamChunk.delta.text);
                  
                  process.stdout.write(streamChunk.delta.text);

                  hasContent = true;
                } else if (streamChunk.delta.type === 'input_json_delta' && streamChunk.delta.partial_json) {
                  process.stdout.write(streamChunk.delta.partial_json);
                  
                  // Check if this is a tool index > 0
                  if (streamChunk.delta.index! > 0) {
                    console.log('Detected tool index > 0, transitioning to TOOL_REQUESTED');
                    
                    // Close the current stream
                    const iterator = completionStream[Symbol.asyncIterator]();
                    if (iterator.return) {
                      await iterator.return();
                    }                
                    
                    ctx.currentToolIndex = 0;
                    // Transition to TOOL_REQUESTED state
                    currentState = transitionState(currentState, 'TOOL_REQUESTED');
                    continue messageProcessing;
                  }
                  
                  // Initialize if undefined
                  if (!ctx.accumulatedInput[streamChunk.delta.index!]) {
                    ctx.accumulatedInput[streamChunk.delta.index!] = '';
                  }
                  ctx.accumulatedInput[streamChunk.delta.index!] += streamChunk.delta.partial_json;
                }
                continue;
              }

              if (isMessageDeltaChunk(streamChunk)) {
                const toolCalls = streamChunk.delta.tool_calls;
                if (toolCalls && toolCalls.length > 0) {
                  const toolCall = toolCalls[0] as unknown as ToolCall;
                  
                  // If we detect any tool call, process it and disconnect
                  if (toolCall.index >= 0) {
                    console.log('Processing function call and disconnecting stream');
                    
                    // Close the current stream
                    const iterator = completionStream[Symbol.asyncIterator]();
                    if (iterator.return) {
                      await iterator.return();
                    }
                    
                    // Transition to TOOL_REQUESTED state to execute the function
                    if (toolCall.id && toolCall.function?.name) {
                      const toolBlock: ToolUseBlock = {
                        type: 'tool_use',
                        id: toolCall.id,
                        index: toolCall.index,
                        name: toolCall.function.name,
                        input: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
                        status: 'pending'
                      };
                      ctx.toolUseBlocks.set(toolCall.index, toolBlock);
                      ctx.currentToolIndex = toolCall.index;
                      ctx.toolCallId = toolCall.id;
                      
                      // Transition to TOOL_REQUESTED state
                      currentState = transitionState(currentState, 'TOOL_REQUESTED');
                      continue messageProcessing;
                    }
                  }

                  // Handle new tool call (index 0)
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
                      ctx.accumulatedInput[toolCall.index] = ''; // Initialize as empty string
                    }
                  }
          
                  // Accumulate function arguments
                  if (toolCall.function?.arguments) {
                    // Initialize the accumulated input for this tool index if it's undefined
                    if (!ctx.accumulatedInput[toolCall.index]) {
                      ctx.accumulatedInput[toolCall.index] = ''; // Initialize as empty string
                    }
                    ctx.accumulatedInput[toolCall.index] += toolCall.function.arguments;
                  }

                  if (toolCall.parameters) {
                    ctx.accumulatedInput[toolCall.index] += JSON.stringify(toolCall.parameters);
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
                    accumulatedInput: ctx.accumulatedInput[ctx.currentToolIndex!]
                  });
          
                  if (ctx.currentToolIndex !== null && ctx.accumulatedInput) {
                    const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex);
                    if (currentTool) {
                      try {
                        // Parse accumulated JSON and store in tool block
                        const inputStr = ctx.accumulatedInput[ctx.currentToolIndex!] || '{}';
                        const inputObject = JSON.parse(inputStr);
                        currentTool.input = inputObject;
                        console.log('Parsed tool input:', inputObject);
                        currentState = transitionState(currentState, 'TOOL_REQUESTED');
                        continue messageProcessing;
                      } catch (err) {
                        console.error('Failed to parse tool input JSON:', {
                          err,
                          input: ctx.accumulatedInput[ctx.currentToolIndex!]
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
                  // Save any remaining text content
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

                  // Check for any pending tool executions
                  const pendingTools = Array.from(ctx.toolUseBlocks.values())
                    .filter(tool => tool.status === 'pending');
                  
                  if (pendingTools.length > 0) {
                    ctx.sendEvent('token', `\nExecuting ${pendingTools.length} pending tool(s)...\n`);
                    for (const tool of pendingTools) {
                      ctx.currentToolIndex = tool.index;
                      ctx.toolCallId = tool.id;
                      currentState = transitionState(currentState, 'TOOL_EXECUTING');
                      continue messageProcessing;
                    }
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
              console.log('currentToolIndex', ctx.currentToolIndex);
              console.log('toolUseBlocks has index', ctx.toolUseBlocks.has(ctx.currentToolIndex || 0));
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Validate JSON
            const currentTool = ctx.toolUseBlocks.get(ctx.currentToolIndex)!;
            try {
              // Initialize if undefined
              if (!ctx.accumulatedInput[ctx.currentToolIndex!]) {
                ctx.accumulatedInput[ctx.currentToolIndex!] = ''; // Initialize as empty string
              }
              
              // Get and clean the input
              const inputStr = (ctx.accumulatedInput[ctx.currentToolIndex!] || '').trim();
              
              // Handle empty input
              if (!inputStr || inputStr === 'undefined{}') {
                currentTool.input = {};
              } else {
                // Try to parse JSON
                const inputObject = JSON.parse(inputStr);
                currentTool.input = inputObject;
              }
              
              currentTool.id = ctx.toolCallId;
              currentTool.status = 'executing';
            } catch (err) {
              console.error('Failed to parse tool input JSON:', {
                err,
                input: ctx.accumulatedInput[ctx.currentToolIndex!],
              });
              currentTool.status = 'complete';
              ctx.toolUseBlocks.delete(ctx.currentToolIndex);
              currentState = transitionState(currentState, 'READING_STREAM');
              break;
            }

            // Send tool use event
            ctx.sendEvent('tool_use', JSON.stringify({
              name: currentTool.name,
              input: currentTool.input,
              tool_use_id: ctx.toolCallId
            }));

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
            // Get all pending tools
            // const pendingTools = Array.from(ctx.toolUseBlocks.values())
            //   .filter(tool => tool.status === 'executing');

            // Execute all pending tools
            for (const [idx, tool] of ctx.toolUseBlocks) {
              if (idx > 0) {
                console.log('skipping tool', tool);
                continue;
              }

              // ctx.sendEvent('token', `\nExecuting tool: ${tool.name}...\n`);
              try {
                const result = await executeToolAndGetResult(tool);
                console.log('Tool execution result:', result);
                // ctx.sendEvent('token', `Tool execution completed.\n`);
                ctx.sendEvent('tool_result', JSON.stringify({
                  role: 'tool',
                  content: result,
                  tool_call_id: tool.id,
                  name: tool.name,
                }));

                // Add result to messages
                ctx.currentMessages.push({
                  role: 'tool',
                  content: result,
                  tool_call_id: tool.id,
                  name: tool.name,
                });

                // Mark tool as complete
                tool.status = 'complete';
                ctx.toolUseBlocks.delete(tool.index);
              } catch (error) {
                console.error('Failed to execute tool:', error);
                ctx.sendEvent('error', `Failed to execute tool: ${String(error)}`);
              }
            }

            // Reset all state
            ctx.currentToolIndex = null;
            ctx.currentInput = '';
            ctx.toolCallId = '';
            ctx.accumulatedInput = [];

            // Create new stream with updated context
            const params: StreamChatCompletionParams = {
              model: process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini',
              systemPrompt: ctx.systemMessage,
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
