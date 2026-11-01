import { registerHooks } from 'node:module';

const placeholder = `
export class EmailNotificationService {
  constructor() {}
  async sendNotification() { throw new Error('worker mail placeholder was executed'); }
}
export function getEmailNotificationService() { return new EmailNotificationService(); }
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith('/dist/packages/notifications/src/notifications/email.js')) {
      return {
        url: `data:text/javascript,${encodeURIComponent(placeholder)}`,
        shortCircuit: true,
      };
    }
    return resolved;
  },
});
