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
  console.log('\x1b[36m[AI-ROUTE] 🔍 Parsing XML buffer for function calls...\x1b[0m');
  
  // Try self-closing tag format first: <func-call name="tool_name"/>
  const selfClosingMatch = xmlBuffer.match(/^([\s\S]*?)<func-call\s+name="([^"]+)"\s*\/>([\s\S]*)$/);
  if (selfClosingMatch) {
    const [, textBefore, funcName, remainingText] = selfClosingMatch;
    console.log(`\x1b[32m[AI-ROUTE] ✅ Self-closing function call detected: ${funcName}\x1b[0m`);
    return { funcName, xmlArgs: {}, textBefore, remainingText };
  }
  
  // Try regular opening/closing tag format: <func-call name="tool_name">...</func-call>
  const funcCallMatch = xmlBuffer.match(/^([\s\S]*?)<func-call\s+name="([^"]+)">([\s\S]*?)<\/func-call>([\s\S]*)$/);
  if (!funcCallMatch) {
    console.log('\x1b[33m[AI-ROUTE] ⚠️  No function call match found\x1b[0m');
    return null;
  }

  const [, textBefore, funcName, argsXml, remainingText] = funcCallMatch;
  console.log(`\x1b[32m[AI-ROUTE] ✅ Function call detected: ${funcName}\x1b[0m`);
  
  const xmlArgs: Record<string, string> = {};

  // Extract parameters from XML
  const paramMatches = argsXml.matchAll(/<([^>]+)>([\s\S]*?)<\/\1>/g);
  for (const match of Array.from(paramMatches)) {
    xmlArgs[match[1]] = match[2].trim();
    console.log(`\x1b[35m[AI-ROUTE] 📋 Parameter: ${match[1]} = ${match[2].trim()}\x1b[0m`);
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
        console.log(`\x1b[34m[AI-ROUTE] 📡 Sending SSE event: ${type}\x1b[0m`);
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
          maxTokens: 32768,
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

            // Check for complete function call (both self-closing and regular format)
            if (buffer.includes('</func-call>') || buffer.match(/<func-call[^>]*\/>/)) {
              console.log('\x1b[36m[AI-ROUTE] 🎯 Complete function call detected in buffer\x1b[0m');

              const funcCall = extractFuncCall(buffer);
              if (funcCall) {
                // Send any text before the function call
                // if (funcCall.textBefore.trim()) {
                //   sendEvent('token', funcCall.textBefore);
                // }

                // Generate a unique ID for this tool use
                const toolUseId = `tool_${Date.now()}_${funcCall.funcName}`;
                console.log(`\x1b[32m[AI-ROUTE] 🆔 Generated tool use ID: ${toolUseId}\x1b[0m`);

                // Send tool use event and close the stream
                console.log(`\x1b[31m[AI-ROUTE] 🚀 Sending tool_use event for: ${funcCall.funcName}\x1b[0m`);
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
    console.log('\x1b[44m[AI-ROUTE] 🌐 POST request received\x1b[0m');
    const body = await req.json();
    console.log(`\x1b[44m[AI-ROUTE] 📨 Processing ${body.messages?.length || 0} messages\x1b[0m`);
    return handleAIRequest(body.messages);
  } catch (error) {
    console.error('\x1b[41m[AI-ROUTE] ❌ Error in AI processing:\x1b[0m', error);
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
