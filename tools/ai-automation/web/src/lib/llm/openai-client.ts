import { BaseOpenAIClient } from './base-openai-client';

export class OpenAIClient extends BaseOpenAIClient {
  constructor(apiKey: string) {
    super({ apiKey });
  }
}
