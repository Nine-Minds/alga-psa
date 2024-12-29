import { Anthropic } from '@anthropic-ai/sdk';
import Message from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import { 
  observeBrowser, 
  executeScript, 
  executeNodeScript 
} from '../../../tools/invokeTool';

type ToolInput = {
  code?: string;
  [key: string]: unknown;
};

// Internal message type for our application
interface LocalMessage {
  role: 'user' | 'assistant';
  content: string | (Message.ContentBlock | Message.ToolResultBlockParam)[];
}

// Convert our Message type to Anthropic's expected MessageParam format
function convertToAnthropicMessage(msg: LocalMessage): Message.MessageParam {
  if (typeof msg.content === 'string') {
    return {
      role: msg.role,
      content: msg.content
    };
  }
  
  // For content blocks, we need to ensure they match Anthropic's expected format
  return {
    role: msg.role,
    content: msg.content.map(block => {
      if ('tool_use_id' in block) {
        // This is a tool result block
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error
        } as Message.ToolResultBlockParam;
      }
      // Return other block types as-is
      return block;
    })
  };
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function executeToolAndGetResult(toolBlock: Message.ToolUseBlock): Promise<string> {
  const { name, input } = toolBlock;
  const toolInput = input as ToolInput;

  try {
    let result;
    if (name === 'observe_browser') {
      result = await observeBrowser();
    } else if (name === 'execute_script' && toolInput.code) {
      result = await executeScript(toolInput.code);
    } else if (name === 'execute_node_script' && toolInput.code) {
      result = await executeNodeScript(toolInput.code);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Extract the actual result value
    if (!result || typeof result !== 'object') {
      return String(result);
    }

    // Handle error cases
    if ('error' in result) {
      throw new Error(result.error as string);
    }
    if ('success' in result && !result.success) {
      throw new Error('Tool execution failed');
    }

    // Extract the actual result value from the success response
    if ('result' in result) {
      const actualResult = result.result;
      
      // For observe_browser response
      if (typeof actualResult === 'object' && actualResult && 'url' in actualResult) {
        return actualResult.url;
      }

      // For script execution response - handle double nesting
      if (typeof actualResult === 'object' && actualResult && 'result' in actualResult) {
        return JSON.stringify(actualResult.result);
      }

      // For direct values
      return JSON.stringify(actualResult);
    }

    // Fallback for unexpected response format
    return JSON.stringify(result);
  } catch (error) {
    return `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function POST(req: Request) {
  const { messages: rawMessages } = await req.json();
  
  // Initialize state
  let completion;
  const allResponseBlocks = [];

  // Filter initial messages to only user/assistant roles
  const initialMessages = rawMessages.filter(
    (msg: { role: string }) => msg.role === 'user' || msg.role === 'assistant'
  ) as LocalMessage[];

  // Keep track of the full conversation history
  const currentMessages: LocalMessage[] = [...initialMessages];
  
  try {
    // Continue executing tools and getting responses until no more tool uses
    do {
      // Convert messages to Anthropic's format
      const anthropicMessages = currentMessages.map(convertToAnthropicMessage);
      
      // Log the request being sent to Anthropic
      console.log('Sending request to Anthropic:', JSON.stringify({
        messages: anthropicMessages,
        tools,
        system: 'You are a helpful assistant that can observe the page and execute scripts via Puppeteer.'
      }, null, 2));
      
      completion = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are a helpful assistant that can observe the page and execute scripts via Puppeteer.',
        messages: anthropicMessages,
        tools,
        max_tokens: 1024,
        temperature: 0.2,
      });

      console.log('Completion:', JSON.stringify(completion, null, 2));

      // Process response blocks and add to conversation history
      for (const block of completion.content as Message.ContentBlock[]) {
        if (block.type === 'text') {
          allResponseBlocks.push(block.text);
        } else if (block.type === 'tool_use') {
          const toolCall = block as Message.ToolUseBlock;
          const toolMessage = `[Tool Use: ${toolCall.name} (${toolCall.id})]`;
          allResponseBlocks.push(toolMessage);
        }
      }

      // Add assistant's response to conversation history
      const assistantMessage: LocalMessage = {
        role: 'assistant',
        content: completion.content as Message.ContentBlock[]
      };
      currentMessages.push(assistantMessage);

      // If Claude's response is complete (not stopped for tool use), break the loop
      if (completion.stop_reason !== 'tool_use') {
        break;
      }

      // Get the tool use block
      const toolBlock = completion.content.find(block => block.type === 'tool_use') as Message.ToolUseBlock;

      // Log the tool use details
      console.log('Executing tool:', JSON.stringify({
        name: toolBlock.name,
        id: toolBlock.id,
        input: toolBlock.input
      }, null, 2));

      // Execute the tool and format result as a message for Claude
      const result = await executeToolAndGetResult(toolBlock);
      const isError = result.startsWith('Failed to execute');
      
      // Format the tool result following Anthropic's expected structure
      const toolResultMessage: LocalMessage = {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }],
          is_error: isError
        } as Message.ToolResultBlockParam]
      };

      // Log the complete tool interaction
      console.log('Tool Interaction:', JSON.stringify({
        tool_details: {
          name: toolBlock.name,
          id: toolBlock.id,
          input: toolBlock.input
        },
        raw_result: result,
        formatted_message: toolResultMessage,
        is_error: isError
      }, null, 2));
      
      currentMessages.push(toolResultMessage);
      allResponseBlocks.push(`[Tool Result: ${result}]`);

      // Helper function to format message content
      const formatMessageContent = (msg: LocalMessage) => ({
        role: msg.role,
        content: typeof msg.content === 'string' 
          ? msg.content 
          : msg.content.map(block => {
              if (block.type === 'text') {
                return { type: 'text', text: block.text };
              }
              if (block.type === 'tool_use') {
                return {
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: block.input
                };
              }
              if ('tool_use_id' in block) {
                return {
                  type: 'tool_result',
                  tool_use_id: block.tool_use_id,
                  content: block.content,
                  is_error: block.is_error
                };
              }
              return block;
            })
      });

      // Get the last 2 messages (the assistant's response and tool result if any)
      const recentMessages = currentMessages.slice(-2);
      
      // Log conversation state
      console.log('Conversation State:', JSON.stringify({
        total_messages: currentMessages.length,
        recent_messages: recentMessages.map(msg => ({
          ...formatMessageContent(msg),
          index: currentMessages.indexOf(msg)
        })),
        stop_reason: completion.stop_reason
      }), null, 2);
    } while (true);

    // Return all collected responses
    return NextResponse.json({ reply: allResponseBlocks.join('\n') });
  } catch (error) {
    console.error('Error in AI processing:', error);
    return NextResponse.json({ 
      reply: `Error processing request: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 });
  }
}
