import type { HfInference } from '@huggingface/inference';

export async function* evaluatePrompt(
  prompt: string,
  hf: unknown, // HfInferenceEndpoint - not currently used
  selectedAccount: string,
  selectedUserId: string,
  controller: AbortController,
  auth_token: string,
  chatId: string,
  messageCount: number,
  onToken: (text: string) => void
) {
  try {
    const response = await fetch('https://inference.9minds.ai/generate_stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { 
          max_new_tokens: 2048, 
          temperature: 0.35, 
          top_p: 0.65, 
          top_k: 15,
          adapter_id: "/data/677ef1f1-d91e-4f33-b0a2-2067e2fc771c/checkpoint-900/peft"       
        },
        meta: { 
          account_id: selectedAccount, 
          user_id: selectedUserId, 
          authorization: auth_token, 
          chat_id: chatId, 
          chat_response_index: messageCount 
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get reader from response');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.trim() === '') continue;
        
        // Remove "data:" prefix and trim whitespace
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);
          if (data.error) {
            yield { error: true, message: data.message };
            continue;
          }

          yield data;
          if (data.token?.text) {
            onToken(data.token.text);
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        yield { error: true, message: "Chat stream was aborted" };
      } else {
        console.error('Error in chat stream:', error);
        yield { error: true, message: "An unexpected error occurred in chat stream" };
      }
    }
  }
}

export async function* evaluatePromptTitle(
  prompt: string,
  hf: HfInference,
  selectedAccount: string,
  selectedUserId: string,
  controller: AbortController,
  auth_token: string,
  chatId: string,
  messageCount: number,
  onToken: (text: string) => void
) {
  try {
    const response = await fetch('/api/chat/stream/title', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { 
          max_new_tokens: 2048, 
          temperature: 0.35, 
          top_p: 0.65, 
          top_k: 15 
        },
        meta: { 
          account_id: selectedAccount, 
          user_id: selectedUserId, 
          authorization: auth_token, 
          chat_id: chatId, 
          chat_response_index: messageCount 
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get reader from response');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.trim() === '') continue;

        // Remove "data:" prefix and trim whitespace
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);
          if (data.error) {
            yield { error: true, message: data.message };
            continue;
          }

          yield data;
          if (data.token?.text) {
            onToken(data.token.text);
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        yield { error: true, message: "Title stream was aborted" };
      } else {
        console.error('Error in title stream:', error);
        yield { error: true, message: "An unexpected error occurred in title stream" };
      }
    }
  }
}
