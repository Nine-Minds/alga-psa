import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { ApplicationFailure } from '@temporalio/common';
import { resolveInputMapping, resolveExpressionsWithSecrets } from '../../../../../shared/workflow/runtime/utils/mappingResolver';
import { buildWorkflowRuntimeV2ExpressionContext } from '../workflow-runtime-v2-interpreter';

// Real shipped definition, expression mapping and Temporal control flow.
// Node/action effects are fixtures; this does not prove persistence or parsing.
it.each(['reply', 'new', 'unmatched', 'missing-defaults', 'attachment-failure', 'ack-failure', 'parse-failure'])(
  'runs inbound email definition through Temporal: %s', async scenario => {
    const definition = JSON.parse(readFileSync(path.resolve(import.meta.dirname,
      '../../../../../shared/workflow/runtime/workflows/email-processing-workflow.v2.json'), 'utf8'));
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `email-definition-${randomUUID()}`;
    const runId = randomUUID();
    const payload = { tenantId: 'tenant-email', providerId: 'provider-email', emailData: {
      id: 'message-email', subject: 'Support request', from: { email: 'sender@example.invalid' },
      body: { text: 'Help', html: '<p>Help</p>' }, attachments: [{ id: 'attachment-email', name: 'example.txt' }],
    } };
    const parsedEmail = { sanitizedText: 'Help', sanitizedHtml: '<p>Help</p>', confidence: 'high' };
    const ticketContext = { ticketDefaults: scenario === 'missing-defaults' ? null : { board_id: 'board-email' },
      matchedClient: scenario === 'unmatched' ? null : { email: 'sender@example.invalid' },
      targetClientId: 'client-email', targetContactId: 'contact-email', targetAuthorUserId: null, targetLocationId: null };
    const calls: Array<{ action: string; input: any; key: unknown }> = [];
    const states: string[] = [];
    const completions: unknown[] = [];
    const initialScopes = { payload, workflow: {}, lexical: [], meta: {}, error: null,
      system: { runId, tenantId: payload.tenantId, workflowId: definition.id, workflowVersion: definition.version,
        definitionHash: 'email-engine-fixture', runtimeSemanticsVersion: '2026-04-08.temporal-native.v1' } };
    try {
      const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue,
        workflowsPath: path.resolve(import.meta.dirname, '../workflow-runtime-v2-run-workflow.ts'),
        bundlerOptions: { webpackConfigHook: config => ({ ...config, resolve: { ...config.resolve,
          alias: { ...config.resolve?.alias, '@alga-psa/workflows': path.resolve(import.meta.dirname, '../../../../packages/workflows/src') } } }) },
        activities: {
          loadWorkflowRuntimeV2PinnedDefinition: async () => ({ definition, initialScopes }),
          projectWorkflowRuntimeV2StepStart: async () => ({ stepId: randomUUID() }),
          projectWorkflowRuntimeV2StepCompletion: async () => undefined,
          completeWorkflowRuntimeV2Run: async (input: unknown) => { completions.push(input); },
          executeWorkflowRuntimeV2NodeStep: async ({ step, scopes }: any) => {
            switch (step.type) {
              case 'state.set': states.push(step.config.state); scopes.meta.state = step.config.state; break;
              case 'transform.assign': scopes.workflow.processedAt = '2026-09-07T00:00:00.000Z'; break;
              case 'email.parseBody':
                if (scenario === 'parse-failure') throw ApplicationFailure.nonRetryable('synthetic parse failure');
                scopes.workflow.parsedEmail = parsedEmail; break;
              default: throw ApplicationFailure.nonRetryable(`Unexpected node: ${step.type}`);
            }
            return { scopes };
          },
          executeWorkflowRuntimeV2ActionStep: async ({ step, scopes }: any) => {
            const context = buildWorkflowRuntimeV2ExpressionContext(scopes);
            const input = await resolveInputMapping(step.config.inputMapping, { expressionContext: context });
            const key = await resolveExpressionsWithSecrets(step.config.idempotencyKey, context);
            const action = step.config.actionId;
            calls.push({ action, input, key });
            let output: unknown;
            switch (action) {
              case 'resolve_existing_ticket_from_email': output = { ticket: scenario === 'reply' ? { ticketId: 'ticket-existing' } : null }; break;
              case 'resolve_inbound_ticket_context': output = ticketContext; break;
              case 'create_comment_from_parsed_email': output = { comment_id: 'comment-email' }; break;
              case 'create_ticket_with_initial_comment': output = { ticket_id: 'ticket-new', ticket_number: 'T-1' }; break;
              case 'process_email_attachments_batch':
                if (scenario === 'attachment-failure') throw ApplicationFailure.nonRetryable('synthetic attachment failure');
                output = { processed: 1, failed: 0 }; break;
              case 'send_ticket_acknowledgement_email':
                if (scenario === 'ack-failure') throw ApplicationFailure.nonRetryable('synthetic acknowledgement failure');
                output = { success: true }; break;
              case 'create_human_task_for_email_processing_failure': output = { task_id: 'task-email' }; break;
              default: throw ApplicationFailure.nonRetryable(`Unexpected action: ${action}`);
            }
            return { output, saveAsPath: step.config.saveAs ?? null };
          },
        } });
      await worker.runUntil(() => environment.client.workflow.execute('workflowRuntimeV2RunWorkflow', {
        taskQueue, workflowId: randomUUID(), workflowExecutionTimeout: '30s',
        args: [{ runId, tenantId: payload.tenantId, workflowId: definition.id, workflowVersion: definition.version }],
      }));
      expect(completions).toEqual([{ runId, status: 'SUCCEEDED' }]);
      const actions = calls.map(call => call.action);
      if (scenario === 'parse-failure') {
        expect(states.slice(-2)).toEqual(['ERROR_PROCESSING_EMAIL', 'AWAITING_MANUAL_RESOLUTION']);
        expect(actions).toEqual(['create_human_task_for_email_processing_failure']);
        expect(calls[0].input.contextData).toMatchObject({ emailId: payload.emailData.id, providerId: payload.providerId,
          senderEmail: payload.emailData.from.email, emailSubject: payload.emailData.subject });
        expect(calls[0].input.contextData.errorMessage).toContain('synthetic parse failure');
      } else if (scenario === 'missing-defaults') {
        expect(states.at(-1)).toBe('ERROR_NO_TICKET_DEFAULTS');
        expect(actions).toEqual(['resolve_existing_ticket_from_email', 'resolve_inbound_ticket_context']);
      } else if (scenario === 'reply') {
        expect(actions).toEqual(['resolve_existing_ticket_from_email', 'create_comment_from_parsed_email', 'process_email_attachments_batch']);
        expect(calls[1]).toMatchObject({ input: { ticketId: 'ticket-existing', parsedEmail, author_type: 'contact', source: 'email' }, key: 'message-email:ticket-existing' });
        expect(calls[2]).toMatchObject({ input: { attachments: payload.emailData.attachments, tenant: payload.tenantId, providerId: payload.providerId }, key: 'message-email:ticket-existing:attachments' });
      } else {
        expect(states.at(-1)).toBe('EMAIL_PROCESSED');
        expect(calls[1].input).toEqual({ tenantId: payload.tenantId, providerId: payload.providerId, senderEmail: payload.emailData.from.email });
        expect(calls[2]).toMatchObject({ action: 'create_ticket_with_initial_comment', key: 'provider-email:message-email', input: {
          parsedEmail, ticketDefaults: ticketContext.ticketDefaults, targetClientId: 'client-email', targetContactId: 'contact-email' } });
        expect(calls[3]).toMatchObject({ action: 'process_email_attachments_batch', key: 'message-email:ticket-new:attachments', input: { ticketId: 'ticket-new', attachments: payload.emailData.attachments } });
        expect(actions).not.toContain('create_human_task_for_email_processing_failure');
        expect(actions.includes('send_ticket_acknowledgement_email')).toBe(scenario !== 'unmatched');
      }
    } finally { await environment.teardown(); }
  });
