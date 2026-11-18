import { createEntityWebhookSubscriber } from './entityWebhookSubscriber';

/** client.* / contact.* / client_location.* webhooks. All wiring comes from webhooks/eventRegistry.ts. */
export const clientWebhookSubscriber = createEntityWebhookSubscriber('client', 'ClientWebhookSubscriber');
export const contactWebhookSubscriber = createEntityWebhookSubscriber('contact', 'ContactWebhookSubscriber');
export const clientLocationWebhookSubscriber = createEntityWebhookSubscriber(
  'client_location',
  'ClientLocationWebhookSubscriber',
);

export const quoteWebhookSubscriber = createEntityWebhookSubscriber('quote', 'QuoteWebhookSubscriber');

export const ENTITY_WEBHOOK_SUBSCRIBERS = [
  clientWebhookSubscriber,
  contactWebhookSubscriber,
  clientLocationWebhookSubscriber,
  quoteWebhookSubscriber,
] as const;
