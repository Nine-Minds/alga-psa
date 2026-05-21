import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');

describe('subscriber index project webhook registration', () => {
  it('registers and unregisters the project webhook subscriber', () => {
    expect(source).toContain(
      "import { registerProjectWebhookSubscriber, unregisterProjectWebhookSubscriber } from './projectWebhookSubscriber';",
    );
    expect(source).toContain("{ name: 'projectWebhook', register: registerProjectWebhookSubscriber }");
    expect(source).toContain("{ name: 'projectWebhook', register: unregisterProjectWebhookSubscriber }");
  });
});
