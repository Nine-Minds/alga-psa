// src/models/HuggingFaceChatModel.ts

import { ChatModelInterface, ChatResponse, StreamResponse, ChatMessage } from 'ee/server/src/interfaces/ChatModelInterface';
import { HfInference, HfInferenceEndpoint } from '@huggingface/inference';
import { evaluatePrompt } from "ee/server/src/services/streaming";

export class HuggingFaceChatModel implements ChatModelInterface {
  private hf: HfInferenceEndpoint;

  constructor(apiKey?: string) {
    try {
      this.hf = new HfInference(apiKey).endpoint('https://inference.9minds.ai');
    } catch (error) {
      console.log('Failed to initialize HuggingFace inference endpoint:', error);
      throw error;
    }
  }

  private constructPrompt(messages: ChatMessage[]): string {
    let prompt = '<s>[INST] <<SYS>>You are a helpful assistant named Alga.<</SYS>>\n';

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageContent = Array.isArray(message.content)
        ? message.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join(' ')
        : message.content.toString();

      if (i === 0 && message.role === 'user') {
        prompt += messageContent.trim() + " [/INST] ";
      } else if (message.role === 'user') {
        prompt += "<s>[INST] " + messageContent.trim() + " [/INST] ";
      } else {
        prompt += messageContent.trim() + " <|end_of_text|>";
      }
    }

    return prompt;
  }

  async sendMessage(
    messages: ChatMessage[],
    options?: {
      selectedAccount?: string;
      userId?: string;
      auth_token?: string;
      chatId?: string;
      messageCount?: number;
    }
  ): Promise<ChatResponse> {
    let accumulatedText = '';
    const prompt = this.constructPrompt(messages);

    try {
      const generator = evaluatePrompt(
        prompt.trim(),
        this.hf,
        options?.selectedAccount || '',
        options?.userId || '',
        new AbortController(),
        options?.auth_token || '',
        options?.chatId || '',
        options?.messageCount || 0,
        () => { }
      );

      for await (const output of generator) {
        if (output.error) {
          return {
            text: "I don't have answer at this time.",
            error: true,
            message: output.message
          };
        }

        if (output.token?.text) {
          accumulatedText += output.token.text;
        }
      }

      return {
        text: accumulatedText
      };
    } catch (error) {
      console.log('Unexpected error in sendMessage:', error);
      throw error;
    }
  }

  async streamMessage(
    messages: ChatMessage[],
    onTokenReceived: (token: string) => void,
    options?: {
      selectedAccount?: string;
      userId?: string;
      auth_token?: string;
      chatId?: string;
      messageCount?: number;
      abortController?: AbortController;
    }
  ): Promise<void> {
    const prompt = this.constructPrompt(messages);

    try {
      const generator = evaluatePrompt(
        prompt.trim(),
        this.hf,
        options?.selectedAccount || '',
        options?.userId || '',
        options?.abortController || new AbortController(),
        options?.auth_token || '',
        options?.chatId || '',
        options?.messageCount || 0,
        (generatedText) => { }
      );

      let context = '';
      let accumulatedTokens = '';

      for await (const output of generator) {
        if (output.error) {
          if (output.message === "Chat stream was aborted" && accumulatedTokens === '') {
            onTokenReceived("I don't have answer at this time.");
            break;
          } else if (output.message === "An unexpected error occurred in chat stream" && accumulatedTokens === '') {
            onTokenReceived("I don't have answer at this time. Please try again later.");
            break;
          }
        }

        if (output.token === undefined) continue;

        if (output.token.special && output.token.context !== undefined) {
            context = output.token.context;
          }
        onTokenReceived(output.token.text);
      }
    } catch (error) {
      console.log('Unexpected error in streamMessage:', error);
      throw error;
    }
  }

  defineFunctions?(functions: any[]): void {
    throw new Error("Function calling not supported");
  }

  callFunction?(functionName: string, args: any): Promise<any> {
    throw new Error("Function calling not supported");
  }
}
