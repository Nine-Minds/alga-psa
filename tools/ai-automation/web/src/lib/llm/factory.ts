import { AnthropicClient } from './anthropic-client';
import { OpenAIClient } from './openai-client';
import { CustomOpenAIClient } from './custom-openai-client';
import { LLMClient } from './types';

export type LLMProvider = 'anthropic' | 'openai' | 'custom-openai';

const MODEL_MAPPINGS = {
  anthropic: {
    'gpt-4': 'claude-3-opus-20240229',
    'gpt-4-turbo': 'claude-3-sonnet-20240229',
    'gpt-3.5-turbo': 'claude-3-haiku-20240307',
    default: 'claude-3-sonnet-20240229'
  },
  openai: {
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo-preview',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    default: 'gpt-4-turbo-preview'
  }
};

export function mapModelName(provider: LLMProvider, model: string): string {
  // For custom OpenAI, use the model name directly
  if (provider === 'custom-openai') {
    return model;
  }
  
  // For other providers, use the mapping
  const mappings = MODEL_MAPPINGS[provider as keyof typeof MODEL_MAPPINGS];
  return mappings[model as keyof typeof mappings] || mappings.default;
}

export function getLLMClient(): LLMClient {
  const provider = process.env.LLM_PROVIDER as LLMProvider || 'anthropic';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const customOpenaiApiKey = process.env.CUSTOM_OPENAI_API_KEY;
  const customOpenaiBaseURL = process.env.CUSTOM_OPENAI_BASE_URL;
  const customOpenaiModel = process.env.CUSTOM_OPENAI_MODEL;

  switch (provider) {
    case 'anthropic':
      if (!anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required when using Anthropic');
      }
      return new AnthropicClient(anthropicApiKey);
    
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
