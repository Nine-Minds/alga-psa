import { StreamChatCompletionParams } from './types';
import { BaseOpenAIClient } from './base-openai-client';
import { mapModelName } from './factory';

export class OpenAIClient extends BaseOpenAIClient {
  constructor(apiKey: string) {
    super({ apiKey });
  }

  protected getModelName(params: StreamChatCompletionParams): string {
    return mapModelName('openai', params.model);
  }
}
