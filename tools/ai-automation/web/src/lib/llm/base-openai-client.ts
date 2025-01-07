import OpenAI from 'openai';
import { LLMClient, StreamChatCompletionParams, StreamChunk } from './types';
import { LocalMessage } from '../../types/messages';
import { ChatCompletionCreateParamsStreaming } from 'openai/resources/index.mjs';

// ----------------------------------------------------------------------------------
// Convert our LocalMessage to something OpenAI can handle
// ----------------------------------------------------------------------------------

function convertToOpenAIMessage(msg: LocalMessage): OpenAI.Chat.ChatCompletionMessageParam[] {
  // Flatten content into a string
  const content = (() => {
    if (msg.content === null) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((block) => ('text' in block ? block.text : ''))
        .join('\n');
    }
    // As fallback, just stringify whatever it is
    return String(msg.content);
  })();

  switch (msg.role) {
    case 'system':
      return [{ role: 'system', content }];
    case 'user':
      return [{ role: 'user', content }];
    case 'assistant':
      return [{ role: 'assistant', content }];
    default:
      // If you have no other roles, just treat as user message
      return [{ role: 'user', content }];
  }
}

// ----------------------------------------------------------------------------------
// Simplified stream parser: just emit text tokens
// ----------------------------------------------------------------------------------

async function* openAIStreamToChunks(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<StreamChunk> {
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    process.stdout.write(choice.delta?.content || '');

    // If there's text content, yield it as a token
    if (choice.delta?.content) {
      yield {
        type: 'content_block_delta',
        delta: {
          type: 'text_delta',
          text: choice.delta.content,
        },
      };
    }

    // If the model says it's done, emit a 'message_stop'
    if (choice.finish_reason) {
      yield { type: 'message_stop' };
      return; // End the stream
    }
  }
}

// ----------------------------------------------------------------------------------
// BaseOpenAIClient
// ----------------------------------------------------------------------------------

export abstract class BaseOpenAIClient implements LLMClient {
  protected openai: OpenAI;

  constructor(config: ConstructorParameters<typeof OpenAI>[0]) {
    this.openai = new OpenAI(config);
  }

  public async *streamChatCompletion(
    params: StreamChatCompletionParams
  ): AsyncIterable<StreamChunk> {
    // Keep XML guidance so the model will produce <func-call> blocks
    const xmlInstructions = `
When using tools, you must format function calls as XML blocks:
1. Always include both opening and closing tags
2. Complete the entire function call before starting explanatory text
3. Format like this:
<func-call name="tool_name">
<param_name>param_value</param_name>
</func-call>

Never leave a function call unclosed. Always include the closing </func-call> tag.
`;

    // Convert messages to OpenAI format
    const messages = [
      {
        role: 'system' as const,
        content: `${xmlInstructions}\n\n${params.systemPrompt}`,
      },
      ...params.messages.flatMap(convertToOpenAIMessage),
    ];

    // Prepare the streaming request
    const completion: ChatCompletionCreateParamsStreaming = {
      model: params.model,
      messages,
      response_format: { type: 'text' }, // We don't do official "function calls" here
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.2,
      stream: true,
    };

    console.log('OpenAI streaming with model:', params.model);
    // console.log('OpenAI stream params:', JSON.stringify(completion, null, 2));

    try {
      // Stream from OpenAI
      const openAIResponse = await this.openai.chat.completions.create(completion);

      // Pass the raw streaming response through our generator
      for await (const chunk of openAIStreamToChunks(openAIResponse)) {
        yield chunk;
      }
    } catch (error) {
      console.error('Unexpected error in openAI request:', error);
      throw error;
    }
  }
}
