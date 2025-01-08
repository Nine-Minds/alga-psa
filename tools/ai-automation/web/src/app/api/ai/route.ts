import { NextResponse } from 'next/server';
import { prompts } from '../../../tools/prompts';
import { getLLMClient } from '../../../lib/llm/factory';
import { LocalMessage } from '../../../types/messages';
// import { send } from 'process';


// ------------------- Types -------------------

type StreamEventType = 'token' | 'tool_result' | 'tool_use' | 'error' | 'done';

interface StreamEvent {
  type: StreamEventType;
  data: string;
}

// Function to parse XML-style tool calls
function extractFuncCall(xmlBuffer: string): { 
  funcName: string; 
  xmlArgs: Record<string, string>; 
  textBefore: string;
  remainingText: string;
} | null {
  const funcCallMatch = xmlBuffer.match(/^([\s\S]*?)<func-call\s+name="([^"]+)">([\s\S]*?)<\/func-call>([\s\S]*)$/);
  if (!funcCallMatch) return null;

  const [, textBefore, funcName, argsXml, remainingText] = funcCallMatch;
  const xmlArgs: Record<string, string> = {};

  // Extract parameters from XML
  const paramMatches = argsXml.matchAll(/<([^>]+)>([\s\S]*?)<\/\1>/g);
  for (const match of Array.from(paramMatches)) {
    xmlArgs[match[1]] = match[2].trim();
  }

  return { funcName, xmlArgs, textBefore, remainingText };
}

// ------------------- Main Handler -------------------

async function handleAIRequest(rawMessages: LocalMessage[]) {
  // Extract system message
  const systemMessage = prompts.systemMessage;
  const messages = rawMessages.filter(msg => msg.role !== 'system');

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

      const client = getLLMClient();
      let buffer = '';
      const messageHistory = [...messages];

      try {
        const stream = await client.streamChatCompletion({
          model: process.env.CUSTOM_OPENAI_MODEL || 'gpt-4o-mini',
          systemPrompt: systemMessage,
          messages: messageHistory,
          maxTokens: 1024,
          temperature: 0.2,
        });

        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && 
              'delta' in chunk && 
              chunk.delta.type === 'text_delta' && 
              chunk.delta.text) {
            
            buffer += chunk.delta.text;
            sendEvent('token', chunk.delta.text);

            //process.stdout.write(chunk.delta.text);

            // Check for complete function call
            if (buffer.includes('</func-call>')) {

              const funcCall = extractFuncCall(buffer);
              if (funcCall) {
                // Send any text before the function call
                // if (funcCall.textBefore.trim()) {
                //   sendEvent('token', funcCall.textBefore);
                // }

                // Generate a unique ID for this tool use
                const toolUseId = `tool_${Date.now()}_${funcCall.funcName}`;

                // Send tool use event and close the stream
                sendEvent('tool_use', JSON.stringify({
                  name: funcCall.funcName,
                  input: funcCall.xmlArgs,
                  tool_use_id: toolUseId
                }));

                // Close the stream - frontend will make a new request
                sendEvent('done', 'true');
                controller.close();
                return;
              }
            }
          } else if (chunk.type === 'message_stop') {
            // Forward the message_stop event to the frontend
            sendEvent('done', 'true');
            controller.close();
            return;
          }
        }

        // If we get here, no function calls were found
        // Send any remaining buffer content
        if (buffer.trim()) {
          messageHistory.push({
            role: 'assistant',
            content: buffer
          });
        }

        sendEvent('done', 'true');
        controller.close();
      } catch (error) {
        console.error('Error in stream processing:', error);
        sendEvent('error', `Stream error: ${String(error)}`);
        controller.close();
      }
    }
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
