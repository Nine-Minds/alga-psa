import { Anthropic } from '@anthropic-ai/sdk';
import Message from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { tools } from '../../../tools/toolDefinitions';
import {
  observeBrowser,
  executeScript
} from '../../../tools/invokeTool';

type ToolInput = {
  code?: string;
  selector?: string;
  [key: string]: unknown;
};

interface LocalMessage {
  role: 'user' | 'assistant';
  content: string | (Message.ContentBlock | Message.ToolResultBlockParam)[];
}

function convertToAnthropicMessage(msg: LocalMessage): Message.MessageParam {
  if (typeof msg.content === 'string') {
    return {
      role: msg.role,
      content: msg.content
    };
  }

  return {
    role: msg.role,
    content: msg.content.map(block => {
      if ('tool_use_id' in block) {
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error
        } as Message.ToolResultBlockParam;
      }
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
      result = await observeBrowser(toolInput.selector);
    } else if (name === 'execute_script' && toolInput.code) {
      result = await executeScript(toolInput.code);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!result || typeof result !== 'object') {
      return String(result);
    }

    if ('error' in result) {
      throw new Error(result.error as string);
    }
    if ('success' in result && !result.success) {
      throw new Error('Tool execution failed');
    }

    if ('result' in result) {
      const actualResult = result.result;

      if (typeof actualResult === 'object' && actualResult && 'url' in actualResult) {
        const { url, title, elements } = actualResult;
        if (elements) {
          return JSON.stringify({ url, title, elements }, null, 2);
        }
        return JSON.stringify({ url, title }, null, 2);
      }

      if (typeof actualResult === 'object' && actualResult && 'result' in actualResult) {
        return String(actualResult.result);
      }

      return String(actualResult);
    }

    return JSON.stringify(result);
  } catch (error) {
    return `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function POST(req: Request) {
  const { messages: rawMessages } = await req.json();

  let completion;
  const allResponseBlocks = [];

  const initialMessages = rawMessages.filter(
    (msg: { role: string }) => msg.role === 'user' || msg.role === 'assistant'
  ) as LocalMessage[];

  const currentMessages: LocalMessage[] = [...initialMessages];

  try {
    do {
      const anthropicMessages = currentMessages.map(convertToAnthropicMessage);

      completion = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are a helpful assistant that can observe the page and execute scripts via Puppeteer.',
        messages: anthropicMessages,
        tools,
        max_tokens: 1024,
        temperature: 0.2,
      });

      console.log('Completion:', JSON.stringify(completion, null, 2));

      for (const block of completion.content as Message.ContentBlock[]) {
        if (block.type === 'text') {
          allResponseBlocks.push(block.text);
        } else if (block.type === 'tool_use') {
          const toolCall = block as Message.ToolUseBlock;
          const toolMessage = `[Tool Use: ${toolCall.name} (${toolCall.id})]`;
          allResponseBlocks.push(toolMessage);
        }
      }

      const assistantMessage: LocalMessage = {
        role: 'assistant',
        content: completion.content as Message.ContentBlock[]
      };
      currentMessages.push(assistantMessage);

      if (completion.stop_reason !== 'tool_use') {
        break;
      }

      const toolBlock = completion.content.find(block => block.type === 'tool_use') as Message.ToolUseBlock;

      const result = await executeToolAndGetResult(toolBlock);
      const isError = result.startsWith('Failed to execute');

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

      console.log('Tool Result:', JSON.stringify({
        tool_id: toolBlock.id,
        result: result,
        formatted_message: toolResultMessage
      }, null, 2));

      currentMessages.push(toolResultMessage);
      allResponseBlocks.push(`[Tool Result: ${result}]`);

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

      const recentMessages = currentMessages.slice(-2);

      console.log('Recent messages:', JSON.stringify(recentMessages.map(msg => ({
        ...formatMessageContent(msg),
        index: currentMessages.indexOf(msg)
      })), null, 2));
    } while (true);

    return NextResponse.json({ reply: allResponseBlocks.join('\n') });
  } catch (error) {
    console.error('Error in AI processing:', error);
    return NextResponse.json({
      reply: `Error processing request: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 });
  }
}