import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeFixture = fileURLToPath(new URL('./worker-email-test-runtime.mjs', import.meta.url));

const placeholder = `
export class EmailNotificationService {
  constructor() {}
  async sendNotification() { throw new Error('WORKER_EMAIL_PLACEHOLDER_SENTINEL'); }
}
export function getEmailNotificationService() { return new EmailNotificationService(); }
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith('/dist/packages/db/src/index.js')) {
      return { url: pathToFileURL(runtimeFixture).href, shortCircuit: true };
    }
    const consumerEntry = process.env.WORKER_EMAIL_REDIRECT_CONSUMER === 'sla-notification'
      ? '/dist/packages/sla/src/services/slaNotificationService.js'
      : '/dist/packages/sla/src/services/escalationService.js';
    if (context.parentURL?.endsWith(consumerEntry)
      && resolved.url.endsWith('/dist/packages/notifications/src/notifications/email.js')) {
      return {
        url: `data:text/javascript,${encodeURIComponent(placeholder)}`,
        shortCircuit: true,
      };
    }
    return resolved;
  },
});
