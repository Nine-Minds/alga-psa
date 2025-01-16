import { OpenAIClient } from './openai-client';
import { CustomOpenAIClient } from './custom-openai-client';
import { LLMClient } from './types';

export type LLMProvider = 'openai' | 'custom-openai';

export function getLLMClient(): LLMClient {
  const provider = process.env.LLM_PROVIDER as LLMProvider || 'openai';
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const customOpenaiApiKey = process.env.CUSTOM_OPENAI_API_KEY;
  const customOpenaiBaseURL = process.env.CUSTOM_OPENAI_BASE_URL;
  const customOpenaiModel = process.env.CUSTOM_OPENAI_MODEL;

  switch (provider) {
    case 'openai':
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required when using OpenAI');
      }
      return new OpenAIClient(openaiApiKey);
    
    case 'custom-openai':
      if (!customOpenaiApiKey) {
        throw new Error('CUSTOM_OPENAI_API_KEY environment variable is required when using Custom OpenAI');
      }
      if (!customOpenaiBaseURL) {
        throw new Error('CUSTOM_OPENAI_BASE_URL environment variable is required when using Custom OpenAI');
      }
      if (!customOpenaiModel) {
        throw new Error('CUSTOM_OPENAI_MODEL environment variable is required when using Custom OpenAI');
      }
      return new CustomOpenAIClient({
        apiKey: customOpenaiApiKey,
        baseURL: customOpenaiBaseURL,
        defaultModel: customOpenaiModel,
      });
    
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
