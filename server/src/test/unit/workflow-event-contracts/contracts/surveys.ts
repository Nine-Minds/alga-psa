import {
  buildCsatAlertTriggeredPayload,
  buildSurveyExpiredPayload,
  buildSurveyReminderSentPayload,
  buildSurveyResponseReceivedPayload,
  buildSurveySentPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/** Surveys / CSAT. Every emitter already used the survey builders; these cases pin their payloads. */

const SURVEY_SERVICE = 'server/src/services/surveyService.ts';
const RESPONSE_ACTIONS = 'packages/surveys/src/actions/surveyResponseActions.ts';
const TOKEN_SERVICE = 'packages/surveys/src/actions/surveyTokenService.ts';

type SurveyEventType =
  | 'SURVEY_SENT'
  | 'SURVEY_REMINDER_SENT'
  | 'SURVEY_RESPONSE_RECEIVED'
  | 'SURVEY_EXPIRED'
  | 'CSAT_ALERT_TRIGGERED';

const system = { actor: { actorType: 'SYSTEM' as const } };
const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };
const contact = { actor: { actorType: 'CONTACT' as const, actorContactId: IDS.contact } };

export const surveyContracts = {
  SURVEY_SENT: {
    status: 'covered',
    cases: [
      {
        site: `${SURVEY_SERVICE}#sendSurveyInvitation`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildSurveySentPayload({
            surveyId: IDS.survey,
            surveyType: 'csat',
            recipientId: IDS.contact,
            ticketId: IDS.ticket,
            sentAt: NOW,
            channel: 'email',
            templateId: IDS.surveyTemplate,
          }),
      },
      {
        // project-subject survey sent by the system (no acting user)
        site: `${SURVEY_SERVICE}#sendSurveyInvitation`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildSurveySentPayload({
            surveyId: IDS.survey,
            surveyType: 'csat',
            recipientId: IDS.contact,
            projectId: IDS.project,
            sentAt: NOW,
            channel: 'email',
            templateId: IDS.surveyTemplate,
          }),
      },
    ],
  },
  SURVEY_REMINDER_SENT: {
    status: 'covered',
    cases: [
      {
        site: `${SURVEY_SERVICE}#sendSurveyInvitation`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildSurveyReminderSentPayload({
            surveyId: IDS.survey,
            recipientId: IDS.contact,
            ticketId: IDS.ticket,
            sentAt: NOW,
            channel: 'email',
            reminderNumber: 2,
          }),
      },
    ],
  },
  SURVEY_RESPONSE_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: `${RESPONSE_ACTIONS}#submitSurveyResponseInternal`,
        ctx: { ...contact, occurredAt: NOW },
        build: () =>
          buildSurveyResponseReceivedPayload({
            surveyId: IDS.survey,
            responseId: IDS.surveyResponse,
            recipientId: IDS.contact,
            ticketId: IDS.ticket,
            respondedAt: NOW,
            score: 2,
            comment: 'Took three days to get a reply.',
          }),
      },
      {
        // anonymous invitation (no contact): SYSTEM actor, no comment
        site: `${RESPONSE_ACTIONS}#submitSurveyResponseInternal`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildSurveyResponseReceivedPayload({
            surveyId: IDS.survey,
            responseId: IDS.surveyResponse,
            recipientId: IDS.ticket,
            ticketId: IDS.ticket,
            respondedAt: NOW,
            score: 5,
          }),
      },
    ],
  },
  SURVEY_EXPIRED: {
    status: 'covered',
    cases: [
      {
        site: `${TOKEN_SERVICE}#resolveSurveyTenantFromToken`,
        ctx: { ...system, occurredAt: EARLIER },
        build: () =>
          buildSurveyExpiredPayload({
            surveyId: IDS.survey,
            recipientId: IDS.contact,
            ticketId: IDS.ticket,
            expiredAt: EARLIER,
          }),
      },
    ],
  },
  CSAT_ALERT_TRIGGERED: {
    status: 'covered',
    cases: [
      {
        site: `${RESPONSE_ACTIONS}#submitSurveyResponseInternal`,
        ctx: { ...contact, occurredAt: NOW },
        build: () =>
          buildCsatAlertTriggeredPayload({
            window: 'daily',
            score: 2,
            threshold: 3,
            triggeredAt: NOW,
            scopeType: 'agent',
            scopeId: IDS.assignee,
          }),
      },
      {
        site: `${RESPONSE_ACTIONS}#submitSurveyResponseInternal`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildCsatAlertTriggeredPayload({
            window: 'daily',
            score: 1,
            threshold: 3,
            triggeredAt: NOW,
            scopeType: 'org',
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, SurveyEventType>;
