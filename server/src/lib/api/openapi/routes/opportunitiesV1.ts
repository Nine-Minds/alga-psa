import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ZodTypeAny } from 'zod';
import {
  completeOpportunityActionApiSchema,
  correctOpportunityEvidenceApiSchema,
  createOpportunityApiSchema,
  declaredOpportunityEvidenceApiSchema,
  loseOpportunityApiSchema,
  opportunityListQuerySchema,
  updateOpportunityApiSchema,
  acceptOpportunitySuggestionApiSchema,
  opportunitySuggestionListQuerySchema,
  snoozeOpportunitySuggestionApiSchema,
  winOpportunityApiSchema,
} from '../../schemas/opportunitySchemas';

export function registerOpportunitiesV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Opportunities v1';

  const OpportunityIdParam = registry.registerSchema(
    'OpportunityIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Opportunity UUID from opportunities.opportunity_id.') }),
  );
  const OpportunityEvidenceParams = registry.registerSchema(
    'OpportunityEvidenceParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Opportunity UUID from opportunities.opportunity_id.'),
      evidenceId: zOpenApi.string().uuid().describe('Evidence UUID from opportunity_evidence.evidence_id.'),
    }),
  );
  const OpportunityQuoteParams = registry.registerSchema(
    'OpportunityQuoteParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Opportunity UUID from opportunities.opportunity_id.'),
      quoteId: zOpenApi.string().uuid().describe('Quote UUID from quotes.quote_id.'),
    }),
  );
  const OpportunitySuggestionParams = registry.registerSchema(
    'OpportunitySuggestionParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Suggestion UUID from opportunity_suggestions.suggestion_id.'),
    }),
  );
  const OpportunityCommitmentParams = registry.registerSchema(
    'OpportunityCommitmentParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid(),
      commitmentId: zOpenApi.string().uuid(),
    }),
  );
  const OpportunityMeetingSessionParams = registry.registerSchema(
    'OpportunityMeetingSessionParamsV1',
    zOpenApi.object({ sessionId: zOpenApi.string().uuid() }),
  );
  const OpportunityQbrClientParams = registry.registerSchema(
    'OpportunityQbrClientParamsV1',
    zOpenApi.object({ clientId: zOpenApi.string().uuid() }),
  );

  const ListQuery = registry.registerSchema('OpportunityListQueryV1', opportunityListQuerySchema);
  const CreateBody = registry.registerSchema('CreateOpportunityBodyV1', createOpportunityApiSchema);
  const UpdateBody = registry.registerSchema('UpdateOpportunityBodyV1', updateOpportunityApiSchema);
  const WinBody = registry.registerSchema('WinOpportunityBodyV1', winOpportunityApiSchema);
  const LoseBody = registry.registerSchema('LoseOpportunityBodyV1', loseOpportunityApiSchema);
  const CompleteActionBody = registry.registerSchema('CompleteOpportunityActionBodyV1', completeOpportunityActionApiSchema);
  const EvidenceBody = registry.registerSchema('DeclaredOpportunityEvidenceBodyV1', declaredOpportunityEvidenceApiSchema);
  const CorrectEvidenceBody = registry.registerSchema('CorrectOpportunityEvidenceBodyV1', correctOpportunityEvidenceApiSchema);
  const SuggestionListQuery = registry.registerSchema('OpportunitySuggestionListQueryV1', opportunitySuggestionListQuerySchema);
  const AcceptSuggestionBody = registry.registerSchema('AcceptOpportunitySuggestionBodyV1', acceptOpportunitySuggestionApiSchema);
  const SnoozeSuggestionBody = registry.registerSchema('SnoozeOpportunitySuggestionBodyV1', snoozeOpportunitySuggestionApiSchema);
  const ManagementPeriodQuery = registry.registerSchema(
    'OpportunityManagementPeriodQueryV1',
    zOpenApi.object({
      start: zOpenApi.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: zOpenApi.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  );
  const MeetingReviewBody = registry.registerSchema(
    'OpportunityMeetingReviewBodyV1',
    zOpenApi.object({
      opportunity_id: zOpenApi.string().uuid(),
      note: zOpenApi.string().max(4000).nullable().optional(),
    }),
  );
  const CommitmentCreateBody = registry.registerSchema(
    'OpportunityCommitmentCreateBodyV1',
    zOpenApi.object({ description: zOpenApi.string().min(1).max(4000) }),
  );
  const CommitmentUpdateBody = registry.registerSchema(
    'OpportunityCommitmentUpdateBodyV1',
    zOpenApi.object({
      description: zOpenApi.string().min(1).max(4000).optional(),
      resolution_status: zOpenApi.enum(['open', 'quote_line', 'agreement_line', 'project_task', 'declined']).optional(),
      resolution_ref_id: zOpenApi.string().uuid().nullable().optional(),
    }),
  );
  const QbrCreateBody = registry.registerSchema(
    'OpportunityQbrCreateBodyV1',
    zOpenApi.object({ trigger_keys: zOpenApi.array(zOpenApi.string().min(1)).min(1).max(100) }),
  );

  const ApiError = registry.registerSchema(
    'OpportunityApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );
  const ApiSuccess = registry.registerSchema(
    'OpportunityApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.record(zOpenApi.unknown()),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );
  const ApiPaginated = registry.registerSchema(
    'OpportunityApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
      }).optional(),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
      _links: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );
  const ApiArraySuccess = registry.registerSchema(
    'OpportunityApiArraySuccessV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );
  const WorkQueueSuccess = registry.registerSchema(
    'OpportunityWorkQueueSuccessV1',
    zOpenApi.object({
      data: zOpenApi.record(zOpenApi.unknown()),
    }),
  );
  const TimelineSuccess = registry.registerSchema(
    'OpportunityTimelineSuccessV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.object({
        interaction_id: zOpenApi.string().uuid(),
        title: zOpenApi.string(),
        notes: zOpenApi.string().nullable().optional(),
        interaction_date: zOpenApi.string().datetime(),
        user_name: zOpenApi.string(),
      })),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    description: string;
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    successStatus?: 200 | 201 | 204;
    params?: ZodTypeAny;
    edition?: 'both' | 'ee';
  };

  const defs: Def[] = [
    { method: 'get', path: '/api/v1/opportunities', summary: 'List opportunities', description: 'Lists tenant opportunities using the OpportunityListFilters contract.', query: ListQuery, successStatus: 200 },
    { method: 'post', path: '/api/v1/opportunities', summary: 'Create opportunity', description: 'Creates an open opportunity with a required next action.', body: CreateBody, successStatus: 201 },
    { method: 'get', path: '/api/v1/opportunities/work-queue', summary: 'Get the current user work queue', description: 'Returns the shared server-composed opportunity work queue for the authenticated API-key user.' },
    { method: 'get', path: '/api/v1/opportunities/{id}', summary: 'Get opportunity', description: 'Gets one opportunity by UUID.', params: OpportunityIdParam },
    { method: 'get', path: '/api/v1/opportunities/{id}/timeline', summary: 'List opportunity timeline', description: 'Lists interactions linked to the opportunity, newest first.', params: OpportunityIdParam },
    { method: 'put', path: '/api/v1/opportunities/{id}', summary: 'Update opportunity', description: 'Updates editable opportunity fields; status and stage use dedicated flows.', body: UpdateBody, params: OpportunityIdParam },
    { method: 'delete', path: '/api/v1/opportunities/{id}', summary: 'Delete opportunity', description: 'Deletes an open opportunity after linked quotes are removed.', successStatus: 204, params: OpportunityIdParam },
    { method: 'post', path: '/api/v1/opportunities/{id}/win', summary: 'Win opportunity', description: 'Marks an open opportunity won, optionally converting an accepted linked quote to a draft agreement.', body: WinBody, params: OpportunityIdParam },
    { method: 'post', path: '/api/v1/opportunities/{id}/lose', summary: 'Lose opportunity', description: 'Marks an open opportunity lost with a required loss reason.', body: LoseBody, params: OpportunityIdParam },
    { method: 'post', path: '/api/v1/opportunities/{id}/complete-action', summary: 'Complete next action', description: 'Records the completed action as an interaction and installs the replacement action.', body: CompleteActionBody, params: OpportunityIdParam },
    { method: 'post', path: '/api/v1/opportunities/{id}/evidence', summary: 'Record declared evidence', description: 'Records the declared qualified checkpoint only.', body: EvidenceBody, successStatus: 201, params: OpportunityIdParam },
    { method: 'get', path: '/api/v1/opportunities/{id}/evidence', summary: 'List opportunity evidence', description: 'Lists append-only evidence and corrected records in recorded order.', params: OpportunityIdParam },
    { method: 'post', path: '/api/v1/opportunities/{id}/evidence/{evidenceId}/correct', summary: 'Correct evidence', description: 'Corrects active evidence with an append-only audit note.', body: CorrectEvidenceBody, params: OpportunityEvidenceParams },
    { method: 'post', path: '/api/v1/opportunities/{id}/quotes/{quoteId}/link', summary: 'Link quote', description: 'Links a same-client quote and applies quote lifecycle evidence.', params: OpportunityQuoteParams },
    { method: 'post', path: '/api/v1/opportunities/{id}/quotes/{quoteId}/unlink', summary: 'Unlink quote', description: 'Unlinks a quote, corrects its evidence, and recomputes opportunity values.', successStatus: 204, params: OpportunityQuoteParams },
    { method: 'get', path: '/api/v1/opportunities/suggestions', summary: 'List opportunity suggestions', description: 'Lists generator suggestions, optionally filtered by lifecycle status.', query: SuggestionListQuery, successStatus: 200 },
    { method: 'post', path: '/api/v1/opportunities/suggestions/{id}/accept', summary: 'Accept opportunity suggestion', description: 'Creates a prefilled opportunity and atomically marks the suggestion accepted.', body: AcceptSuggestionBody, successStatus: 201, params: OpportunitySuggestionParams },
    { method: 'post', path: '/api/v1/opportunities/suggestions/{id}/dismiss', summary: 'Dismiss opportunity suggestion', description: 'Dismisses the suggestion and permanently preserves its dedupe key.', params: OpportunitySuggestionParams },
    { method: 'post', path: '/api/v1/opportunities/suggestions/{id}/snooze', summary: 'Snooze opportunity suggestion', description: 'Hides the suggestion until the requested future timestamp.', body: SnoozeSuggestionBody, params: OpportunitySuggestionParams },
    { method: 'get', path: '/api/v1/opportunities/forecast', summary: 'Get forecast band', description: 'Returns floor and ceiling MRR/NRR with per-deal composition for a period.', query: ManagementPeriodQuery, edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/calibration', summary: 'Get seller calibration', description: 'Returns declared-confidence outcomes and new-logo agreement attach rate per seller.', edition: 'ee' },
    { method: 'post', path: '/api/v1/opportunities/meeting-sessions', summary: 'Start meeting session', description: 'Starts or resumes the caller’s same-day pipeline meeting session.', successStatus: 201, edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/meeting-sessions/active', summary: 'Get active meeting session', description: 'Returns the caller’s resumable same-day meeting session and reviews.', edition: 'ee' },
    { method: 'post', path: '/api/v1/opportunities/meeting-sessions/{sessionId}/reviews', summary: 'Mark deal reviewed', description: 'Creates or updates the review marker for a deal in a meeting session.', body: MeetingReviewBody, params: OpportunityMeetingSessionParams, edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/{id}/commitments', summary: 'List commitments', description: 'Lists the promises recorded for an opportunity.', params: OpportunityIdParam, edition: 'ee' },
    { method: 'post', path: '/api/v1/opportunities/{id}/commitments', summary: 'Create commitment', description: 'Records an unresolved promise on an opportunity.', body: CommitmentCreateBody, params: OpportunityIdParam, successStatus: 201, edition: 'ee' },
    { method: 'put', path: '/api/v1/opportunities/{id}/commitments/{commitmentId}', summary: 'Update commitment', description: 'Edits or resolves a commitment to a downstream artifact or explicit decline.', body: CommitmentUpdateBody, params: OpportunityCommitmentParams, edition: 'ee' },
    { method: 'delete', path: '/api/v1/opportunities/{id}/commitments/{commitmentId}', summary: 'Delete commitment', description: 'Deletes a commitment.', params: OpportunityCommitmentParams, successStatus: 204, edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/qbr/{clientId}', summary: 'Get QBR trigger pack', description: 'Assembles renewal, aging/EOL asset, ticket-trend, and whitespace triggers for an account.', params: OpportunityQbrClientParams, edition: 'ee' },
    { method: 'post', path: '/api/v1/opportunities/qbr/{clientId}/opportunities', summary: 'Create QBR opportunities', description: 'Batch-creates typed opportunities from current QBR trigger keys.', body: QbrCreateBody, params: OpportunityQbrClientParams, successStatus: 201, edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/qbr/yield', summary: 'Get QBR yield', description: 'Returns fired, created, and won trigger counts by account and account manager.', edition: 'ee' },
    { method: 'get', path: '/api/v1/opportunities/rollups', summary: 'Get seller rollups', description: 'Returns period pipeline, outcomes, and attach rate by seller.', query: ManagementPeriodQuery, edition: 'ee' },
  ];

  for (const def of defs) {
    const status = def.successStatus ?? 200;
    const responses: Record<number, any> = {
      [status]: status === 204
        ? { description: 'Operation succeeded with no response body.', emptyBody: true }
        : {
            description: 'Operation succeeded.',
            schema: def.path === '/api/v1/opportunities' && def.method === 'get'
              ? ApiPaginated
              : def.path === '/api/v1/opportunities/work-queue'
                ? WorkQueueSuccess
                : def.path === '/api/v1/opportunities/{id}/timeline'
                  ? TimelineSuccess
                  : def.method === 'get' && (
                      def.path === '/api/v1/opportunities/suggestions'
                      || def.path === '/api/v1/opportunities/{id}/evidence'
                      || def.path === '/api/v1/opportunities/calibration'
                      || def.path === '/api/v1/opportunities/{id}/commitments'
                      || def.path === '/api/v1/opportunities/qbr/yield'
                      || def.path === '/api/v1/opportunities/rollups'
                    )
                    ? ApiArraySuccess
                    : ApiSuccess,
          },
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing or invalid.', schema: ApiError },
      403: { description: 'RBAC denied for the opportunities resource action.', schema: ApiError },
      404: { description: 'Opportunity or nested resource not found.', schema: ApiError },
      409: { description: 'Opportunity state conflicts with the requested operation.', schema: ApiError },
      500: { description: 'Unexpected controller or service failure.', schema: ApiError },
    };

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: { schema: def.body } } : {}),
      },
      responses,
      extensions: {
        'x-tenant-scoped': true,
        'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
        'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
        'x-rbac-resource': 'opportunities',
        ...(def.edition === 'ee' ? { 'x-tier-feature': 'OPPORTUNITY_MANAGEMENT' } : {}),
      },
      edition: def.edition ?? 'both',
    });
  }
}
