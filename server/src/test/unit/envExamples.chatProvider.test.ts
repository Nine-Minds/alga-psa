import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const envExampleFiles = [
  path.resolve(process.cwd(), '..', '.env.example'),
  path.resolve(process.cwd(), '..', 'ee', 'server', '.env.example'),
];

const requiredProviderKeys = [
  'AI_CHAT_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'VERTEX_PROJECT_ID',
  'VERTEX_LOCATION',
  'VERTEX_CHAT_MODEL',
];

const optionalProviderKeys = ['VERTEX_OPENAPI_BASE_URL', 'VERTEX_ENABLE_THINKING'];

describe('chat provider env example documentation', () => {
  it('includes OpenRouter and Vertex provider keys in both env examples', () => {
    for (const filePath of envExampleFiles) {
      const content = fs.readFileSync(filePath, 'utf8');

      for (const key of requiredProviderKeys) {
        expect(content).toMatch(new RegExp(`^\\s*${key}=`, 'm'));
      }

      for (const key of optionalProviderKeys) {
        expect(content).toMatch(new RegExp(`^\\s*#?\\s*${key}=`, 'm'));
      }
    }
  });
});
