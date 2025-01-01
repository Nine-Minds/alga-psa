import { StreamChatCompletionParams } from './types';
import { BaseOpenAIClient } from './base-openai-client';

interface CustomOpenAIConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

export class CustomOpenAIClient extends BaseOpenAIClient {
  private defaultModel: string;

  constructor(config: CustomOpenAIConfig) {
    super({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    console.log('CustomOpenAIClient initialized with default model:', config.defaultModel);
    this.defaultModel = config.defaultModel;
  }

  protected getModelName(params: StreamChatCompletionParams): string {
    return params.model || this.defaultModel;
  }
}
