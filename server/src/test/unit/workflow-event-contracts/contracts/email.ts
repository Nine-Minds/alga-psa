import {
  buildEmailBouncedPayload,
  buildEmailComplaintReceivedPayload,
  buildEmailDeliveredPayload,
  buildEmailUnsubscribedPayload,
  buildInboundEmailReceivedPayload,
  buildInboundEmailReplyReceivedPayload,
  buildOutboundEmailFailedPayload,
  buildOutboundEmailQueuedPayload,
  buildOutboundEmailSentPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { NO_EMITTER_UMBRELLA_TICKET } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * Email: inbound receipt/reply, outbound lifecycle, provider feedback (Resend webhook).
 * OUTBOUND_EMAIL_* and INBOUND_EMAIL_RECEIVED used to be hand-built literals; they now go through
 * emailLifecycleEventBuilders so these cases exercise the real payloads.
 */

const BASE_EMAIL = 'packages/email/src/BaseEmailService.ts';
const RESEND = 'server/src/services/email/webhooks/resendWebhookEvents.ts';

type EmailEventType =
  | 'INBOUND_EMAIL_RECEIVED'
  | 'INBOUND_EMAIL_REPLY_RECEIVED'
  | 'EMAIL_PROVIDER_CONNECTED'
  | 'EMAIL_PROVIDER_DISCONNECTED'
  | 'OUTBOUND_EMAIL_QUEUED'
  | 'OUTBOUND_EMAIL_SENT'
  | 'OUTBOUND_EMAIL_FAILED'
  | 'EMAIL_DELIVERED'
  | 'EMAIL_BOUNCED'
  | 'EMAIL_COMPLAINT_RECEIVED'
  | 'EMAIL_UNSUBSCRIBED';

const system = { actor: { actorType: 'SYSTEM' as const } };
const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };

const inboundEmailData = {
  id: 'AAMkAGI2THVSAAA=',
  threadId: 'AAQkAGI2THVSAAA=',
  from: { email: 'jane.doe@acme.example', name: 'Jane Doe' },
  to: [{ email: 'support@msp.example', name: 'Support' }],
  subject: 'Printer offline on the second floor',
  body: { text: 'The printer is offline again.', html: '<p>The printer is offline again.</p>' },
  attachments: [{ id: 'att-1', name: 'photo.jpg', contentType: 'image/jpeg', size: 20480 }],
  receivedAt: NOW,
  tenant: IDS.tenant,
  providerId: IDS.integration,
};

const noProviderEmitter = (event: string) => ({
  status: 'no-product-emitter' as const,
  ticket: NO_EMITTER_UMBRELLA_TICKET,
  reason: `Catalogued with a payload schema, but nothing publishes ${event}: provider OAuth connect/disconnect flows do not emit workflow events yet.`,
});

export const emailContracts = {
  INBOUND_EMAIL_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: 'server/src/services/email/EmailProcessor.ts#EmailProcessor.emitEmailReceivedEvent',
        ctx: { ...system, occurredAt: NOW },
        build: () => buildInboundEmailReceivedPayload({ tenant: IDS.tenant, providerId: IDS.integration, emailData: inboundEmailData }),
      },
      {
        site: 'server/src/services/email/MailHogPollingService.ts#MailHogPollingService.emitEmailReceivedEvent',
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildInboundEmailReceivedPayload({
            tenant: IDS.tenant,
            providerId: IDS.integration,
            emailData: { ...inboundEmailData, mailhogId: 'mh-1' },
          }),
      },
      {
        // diagnostic webhook endpoint: publishes straight to the stream with a synthetic email
        site: 'packages/integrations/src/webhooks/email/test.ts#POST',
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildInboundEmailReceivedPayload({
            tenant: IDS.tenant,
            providerId: 'test-provider',
            emailData: {
              id: 'test-message-123',
              from: { email: 'test@example.com' },
              to: [{ email: 'support@example.com' }],
              subject: 'Test webhook event (microsoft)',
              body: { text: 'Synthetic INBOUND_EMAIL_RECEIVED published by the webhook test endpoint.' },
              receivedAt: NOW,
              tenant: IDS.tenant,
              providerId: 'test-provider',
            },
          }),
      },
    ],
  },
  INBOUND_EMAIL_REPLY_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: 'shared/workflow/actions/emailWorkflowActions.ts#createCommentFromEmail',
        ctx: { actor: undefined, occurredAt: NOW },
        build: () =>
          buildInboundEmailReplyReceivedPayload({
            tenantId: IDS.tenant,
            occurredAt: NOW,
            messageId: 'AAMkAGI2THVSAAA=',
            threadId: 'AAQkAGI2THVSAAA=',
            ticketId: IDS.ticket,
            from: 'Jane Doe <jane.doe@acme.example>',
            to: ['Support <support@msp.example>'],
            subject: 'Re: Printer offline on the second floor',
            receivedAt: NOW,
            provider: 'microsoft',
            matchedBy: 'thread_headers',
          }),
      },
    ],
  },
  EMAIL_PROVIDER_CONNECTED: noProviderEmitter('EMAIL_PROVIDER_CONNECTED'),
  EMAIL_PROVIDER_DISCONNECTED: noProviderEmitter('EMAIL_PROVIDER_DISCONNECTED'),

  OUTBOUND_EMAIL_QUEUED: {
    status: 'covered',
    cases: [
      {
        site: `${BASE_EMAIL}#BaseEmailService.sendEmail`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildOutboundEmailQueuedPayload({
            messageId: IDS.emailMessage,
            threadId: IDS.emailThread,
            ticketId: IDS.ticket,
            from: 'support@msp.example',
            to: ['jane.doe@acme.example'],
            cc: ['manager@acme.example'],
            subject: 'Re: Printer offline on the second floor',
            queuedAt: NOW,
            provider: 'smtp',
          }),
      },
      {
        site: `${BASE_EMAIL}#BaseEmailService.sendEmail`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildOutboundEmailQueuedPayload({
            messageId: IDS.emailMessage,
            from: 'noreply@msp.example',
            to: ['jane.doe@acme.example'],
            subject: 'Reset your password',
            queuedAt: NOW,
            provider: 'resend',
          }),
      },
    ],
  },
  OUTBOUND_EMAIL_SENT: {
    status: 'covered',
    cases: [
      {
        site: `${BASE_EMAIL}#BaseEmailService.sendEmail`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildOutboundEmailSentPayload({
            messageId: IDS.emailMessage,
            providerMessageId: 're_01HZX9',
            threadId: IDS.emailThread,
            ticketId: IDS.ticket,
            sentAt: NOW,
            provider: 'resend',
          }),
      },
    ],
  },
  OUTBOUND_EMAIL_FAILED: {
    status: 'covered',
    cases: [
      {
        // provider returned success:false
        site: `${BASE_EMAIL}#BaseEmailService.sendEmail`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildOutboundEmailFailedPayload({
            messageId: IDS.emailMessage,
            ticketId: IDS.ticket,
            failedAt: NOW,
            provider: 'smtp',
            errorMessage: 'Mailbox unavailable',
            errorCode: '550',
            retryable: false,
          }),
      },
      {
        // unexpected exception while sending
        site: `${BASE_EMAIL}#BaseEmailService.sendEmail`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildOutboundEmailFailedPayload({
            messageId: IDS.emailMessage,
            failedAt: NOW,
            provider: 'smtp',
            errorMessage: 'connect ETIMEDOUT',
            errorCode: 'ETIMEDOUT',
          }),
      },
    ],
  },

  EMAIL_DELIVERED: {
    status: 'covered',
    cases: [
      {
        site: `${RESEND}#mapResendWebhookToWorkflowEvents`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildEmailDeliveredPayload({
            messageId: IDS.emailMessage,
            providerMessageId: 're_01HZX9',
            to: 'jane.doe@acme.example',
            deliveredAt: NOW,
            provider: 'resend',
          }),
      },
    ],
  },
  EMAIL_BOUNCED: {
    status: 'covered',
    cases: [
      {
        site: `${RESEND}#mapResendWebhookToWorkflowEvents`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildEmailBouncedPayload({
            messageId: IDS.emailMessage,
            providerMessageId: 're_01HZX9',
            to: 'jane.doe@acme.example',
            bouncedAt: NOW,
            bounceType: 'hard',
            smtpCode: '550',
            smtpMessage: 'User unknown',
          }),
      },
      {
        site: `${RESEND}#mapResendWebhookToWorkflowEvents`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildEmailBouncedPayload({
            messageId: IDS.emailMessage,
            providerMessageId: 're_01HZX9',
            to: 'jane.doe@acme.example',
            bouncedAt: EARLIER,
            bounceType: 'soft',
          }),
      },
    ],
  },
  EMAIL_COMPLAINT_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: `${RESEND}#mapResendWebhookToWorkflowEvents`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildEmailComplaintReceivedPayload({
            messageId: IDS.emailMessage,
            providerMessageId: 're_01HZX9',
            to: 'jane.doe@acme.example',
            complainedAt: NOW,
            provider: 'resend',
            complaintType: 'abuse',
          }),
      },
    ],
  },
  EMAIL_UNSUBSCRIBED: {
    status: 'covered',
    cases: [
      {
        site: `${RESEND}#mapResendWebhookToWorkflowEvents`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildEmailUnsubscribedPayload({
            recipientEmail: 'jane.doe@acme.example',
            unsubscribedAt: NOW,
            source: 'resend',
            messageId: IDS.emailMessage,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, EmailEventType>;
