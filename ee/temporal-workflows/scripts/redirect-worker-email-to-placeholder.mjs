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
    const consumerEntry = process.env.WORKER_EMAIL_REDIRECT_CONSUMER === 'sla-notification'
      ? '/dist/packages/sla/src/services/slaNotificationService.js'
      : '/dist/packages/sla/src/services/escalationService.js';
    // The other notification consumer remains in the module graph during the
    // negative check. Keep its @alga-psa/email dependency on the same fixture
    // used by the positive build verifier so this check does not depend on the
    // email workspace having been built in the Docker image.
    if (specifier === '@alga-psa/email'
      && context.parentURL?.endsWith('/dist/packages/notifications/src/notifications/email.js')) {
      return { url: pathToFileURL(runtimeFixture).href, shortCircuit: true };
    }
    if (context.parentURL?.endsWith(consumerEntry)
      && specifier.endsWith('/notifications/src/notifications/email.js')) {
      return {
        url: `data:text/javascript,${encodeURIComponent(placeholder)}`,
        shortCircuit: true,
      };
    }

    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith('/dist/packages/db/src/index.js')) {
      return { url: pathToFileURL(runtimeFixture).href, shortCircuit: true };
    }
    return resolved;
  },
});
