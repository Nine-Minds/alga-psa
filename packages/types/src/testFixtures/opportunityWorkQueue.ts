/**
 * Shared contract fixture for consumers of the opportunity work-queue API.
 * Keep this shaped as the service response, not as any individual UI's view model.
 *
 * Deliberately import-free: ee/mobile typechecks this file from its own
 * isolated project, so any import here drags packages/types (react,
 * @js-temporal/polyfill) into the mobile TS program and breaks mobile CI.
 * Type conformance is enforced by opportunityWorkQueue.contract.ts instead.
 */
export const opportunityWorkQueueFixture = {
  user_first_name: 'Avery',
  date: '2026-08-20T14:00:00.000Z',
  found_totals: [
    { currency_code: 'USD', mrr_cents: 125000, nrr_cents: 500000 },
    { currency_code: 'GBP', mrr_cents: 0, nrr_cents: 275000 },
  ],
  do_today: [
    {
      kind: 'action_due',
      opportunity_id: '11111111-1111-4111-8111-111111111111',
      opportunity_number: 'OPP-1001',
      title: 'Acme renewal',
      client_name: 'Acme',
      stage: 'proposed',
      mrr_cents: 125000,
      nrr_cents: 0,
      hardware_cents: 0,
      currency_code: 'USD',
      next_action: 'Call the CTO',
      next_action_due: '2026-08-18T14:00:00.000Z',
      days_overdue: 2,
      days_since_activity: 8,
      why: {
        segments: [
          {
            message: { key: 'opportunities.why.actionDue.pastDue', params: { count: 2 } },
            emphasis: true,
          },
          { message: { key: 'opportunities.why.forClient', params: { clientName: 'Acme' } } },
        ],
      },
      is_screen_primary: true,
    },
  ],
  going_quiet: [
    {
      kind: 'going_quiet',
      opportunity_id: '22222222-2222-4222-8222-222222222222',
      opportunity_number: 'OPP-1002',
      title: 'Globex assessment',
      client_name: 'Globex',
      stage: 'assessment',
      mrr_cents: 0,
      nrr_cents: 275000,
      hardware_cents: 0,
      currency_code: 'GBP',
      next_action: 'Review findings',
      next_action_due: '2026-08-25T14:00:00.000Z',
      days_overdue: 0,
      days_since_activity: 9,
      why: {
        segments: [
          {
            message: { key: 'opportunities.why.goingQuiet.quietAge', params: { count: 9 } },
            emphasis: true,
          },
          { message: { key: 'opportunities.why.goingQuiet.nudge', params: { clientName: 'Globex' } } },
        ],
      },
      is_screen_primary: false,
    },
  ],
  money_found: [
    {
      kind: 'suggestion',
      suggestion_id: '33333333-3333-4333-8333-333333333333',
      generator_key: 'renewal',
      title: { key: 'opportunities.suggestionTitles.renewal', params: { contractName: 'Support' } },
      client_name: 'Acme',
      mrr_cents: 125000,
      nrr_cents: 500000,
      currency_code: 'USD',
      how: { key: 'opportunities.suggestionHow.renewal', params: { clientName: 'Acme' } },
      why: {
        segments: [
          {
            message: { key: 'opportunities.why.renewal.age', params: { count: 45 } },
            emphasis: true,
          },
          { message: { key: 'opportunities.why.renewal.startNow' } },
        ],
      },
    },
  ],
  lesson: {
    insight_key: 'quote_velocity',
    why: {
      segments: [
        {
          message: { key: 'opportunities.why.lesson.quoteVelocity', params: { ratio: 1.8 } },
          emphasis: true,
        },
        { message: { key: 'opportunities.why.lesson.quoteVelocityCompared' } },
      ],
    },
    action_label: { key: 'opportunities.queue.lesson.reviewPipeline' },
    action_href: '/msp/opportunities?tab=pipeline',
  },
} as const;
