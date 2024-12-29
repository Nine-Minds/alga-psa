import { NextRequest } from 'next/server';
import { HuggingFaceChatModel } from '../models/HuggingFaceChatModel';
import { AnthropicChatModel } from '../models/AnthropicChatModel';

interface StreamRequestBody {
  inputs: any[];
  options: any;
  model: string;
  functions?: any[];
  meta?: {
    authorization: string;
  };
}

interface ToolUse {
  name: string;
  input: any;
  id: string;
}

// Define available functions
const availableFunctions = [
  {
    name: "current_time",
    description: "Gets the current time in a machine-readable format. The result should be given back to the user in a friendly format.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async (_input?: any) => {
      const now = new Date();
      return now.toLocaleString();
    }
  }
];

export class ChatStreamService {
  private static getAnthropicModel() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[ChatStreamService] Missing Anthropic API key');
      throw new Error('Anthropic API key is not configured');
    }
    const model = new AnthropicChatModel(apiKey);
    return model;
  }

  private static getHuggingFaceModel() {
    return new HuggingFaceChatModel();
  }

  private static async executeTool(tool: ToolUse, functions: any[]): Promise<string> {
    // First check built-in functions
    const builtInFunction = availableFunctions.find(f => f.name === tool.name);
    if (builtInFunction) {
      try {
        const result = await builtInFunction.execute(tool.input);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`Error executing built-in function ${tool.name}:`, errorMessage);
        throw new Error(errorMessage);
      }
    }

    // Then check passed-in functions
    const fn = functions.find(f => f.name === tool.name);
    if (!fn || !fn.execute) {
      throw new Error(`Function ${tool.name} not found or not executable`);
    }

    try {
      // Execute the function
      const result = await fn.execute(tool.input);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`Error executing function ${tool.name}:`, errorMessage);
      throw new Error(errorMessage);
    }
  }

  static async handleChatStream(req: NextRequest) {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const body = await req.json() as StreamRequestBody;
      const transformStream = new TransformStream({
        transform: async (chunk, controller) => {
          if (chunk.content === '[DONE]') {
            controller.terminate();
          } else {
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      });

      const writer = transformStream.writable.getWriter();
      let currentMessages = [...body.inputs];
      let isStreamComplete = false;

      const onTokenReceived = async (token: string) => {
        try {
          if (token === '[DONE]') {
            isStreamComplete = true;
            writer.close();
            return;
          }

          // Check if the token is a tool use
          const data = JSON.parse(token);
          if (data.type === 'tool_use') {
            const tool = data.tool as ToolUse;
            
            try {
              // Execute the function
              const result = await this.executeTool(tool, body.functions || []);

              // Add the function result to the messages
              currentMessages.push({
                role: 'assistant',
                content: [{
                  type: 'tool_use',
                  id: tool.id,
                  name: tool.name,
                  input: tool.input
                }]
              });
              
              currentMessages.push({
                role: 'user',
                content: [{
                  type: 'tool_result',
                  // tool_result: {
                    tool_use_id: tool.id,
                  // },
                  content: [{ type: 'text', text: JSON.stringify(result) }],
                }]
              });

              console.log('currentMessages', currentMessages);

              // Continue the conversation with the function result
              if (body.model === 'anthropic') {
                const model = this.getAnthropicModel();
                model.defineFunctions([...availableFunctions, ...(body.functions || [])]);
                await model.streamMessage(currentMessages, (token: string) => {
                  writer.write({
                    content: token,
                    type: 'text'
                  });
                }, {
                  ...body.options,
                  auth_token: body.meta?.authorization,
                });
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
              writer.write({
                content: `Error executing ${tool.name}: ${errorMessage}`,
                type: 'error'
              });
            }
          } else {
            throw new Error('Not a tool use');
          }
        } catch (e) {
          // If token is not a tool use JSON, treat it as regular text
          writer.write({
            content: token,
            type: 'text'
          });
        }
      };

      (async () => {
        try {
          if (body.model === 'anthropic') {
            const model = this.getAnthropicModel();
            // Set up available functions including both built-in and passed-in functions
            model.defineFunctions([...availableFunctions, ...(body.functions || [])]);
            await model.streamMessage(body.inputs, onTokenReceived, {
              ...body.options,
              auth_token: body.meta?.authorization
            });
          } else {
            const model = this.getHuggingFaceModel();
            await model.streamMessage(body.inputs, onTokenReceived);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          console.error(`[ChatStreamService][${requestId}] Stream processing error:`, errorMessage);
          writer.write({
            content: "An error occurred during streaming",
            type: 'error'
          });
          if (!isStreamComplete) {
            writer.close();
          }
        }
      })();

      return new Response(transformStream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`[ChatStreamService][${requestId}] Fatal error:`, errorMessage);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  static async handleTitleStream(req: NextRequest) {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const body = await req.json() as StreamRequestBody;
      const model = this.getHuggingFaceModel();
      
      const transformStream = new TransformStream({
        transform: async (chunk, controller) => {
          if (chunk.content === '[DONE]') {
            controller.terminate();
          } else {
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      });

      const writer = transformStream.writable.getWriter();
      const onTokenReceived = (token: string) => {
        if (token === '[DONE]') {
          writer.close();
          return;
        }
        writer.write({
          content: token,
          type: 'text'
        });
      };

      (async () => {
        try {
          await model.streamMessage(body.inputs, onTokenReceived, {
            ...body.options,
            auth_token: body.meta?.authorization
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          console.error(`[ChatStreamService][${requestId}] Title stream error:`, errorMessage);
          writer.write({
            content: "An error occurred during streaming",
            type: 'error'
          });
          writer.close();
        }
      })();

      return new Response(transformStream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`[ChatStreamService][${requestId}] Fatal error in title stream:`, errorMessage);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }
}
