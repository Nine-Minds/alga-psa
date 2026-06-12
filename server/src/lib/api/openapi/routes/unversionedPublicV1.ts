import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/**
 * Real metadata + request schemas for the unversioned public API families
 * (project templates, workflow definitions, workflow runs) that the developer
 * portal surfaces but which were previously served as route-inventory
 * placeholders. Replaces PlaceholderObject request bodies with named schemas.
 */
export function registerUnversionedPublicV1Routes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const err = deps.ErrorResponse;
  const Success = registry.registerSchema(
    'UnversionedV1Success',
    zOpenApi.object({
      data: zOpenApi.union([zOpenApi.record(zOpenApi.unknown()), zOpenApi.array(zOpenApi.record(zOpenApi.unknown()))]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );
  const errs = (extra?: Record<number, string>) => ({
    400: { description: 'Invalid request.', schema: err },
    401: { description: 'API key missing/invalid.', schema: err },
    403: { description: 'Caller lacks the required permission.', schema: err },
    ...(extra ? Object.fromEntries(Object.entries(extra).map(([c, d]) => [Number(c), { description: d, schema: err }])) : {}),
    500: { description: 'Unexpected error.', schema: err },
  });
  const ext = (resource: string, action: string) => ({ 'x-tenant-scoped': true, 'x-rbac-resource': resource, 'x-rbac-action': action });

  // ---- Project templates (tag groups under the Projects hub) ----
  const projTag = 'Project Templates';
  const TemplateIdParam = registry.registerSchema('ProjectTemplateIdParam', zOpenApi.object({ templateId: zOpenApi.string().uuid() }));
  const TemplateCopyOptions = registry.registerSchema('ProjectTemplateCopyOptions', zOpenApi.object({
    copyPhases: zOpenApi.boolean().optional(),
    copyStatuses: zOpenApi.boolean().optional(),
    copyTasks: zOpenApi.boolean().optional(),
    copyDependencies: zOpenApi.boolean().optional(),
    copyChecklists: zOpenApi.boolean().optional(),
    copyServices: zOpenApi.boolean().optional(),
    assignmentOption: zOpenApi.string().optional(),
  }).describe('Which parts of the template to copy when applying it.'));

  registry.registerRoute({
    method: 'post', path: '/api/projects/templates',
    summary: 'Create project template',
    description: 'Creates a project template from an existing project.',
    tags: [projTag], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('ProjectTemplateCreateBody', zOpenApi.object({
      project_id: zOpenApi.string().uuid(),
      template_name: zOpenApi.string().min(1),
      description: zOpenApi.string().optional(),
      category: zOpenApi.string().optional(),
    })) } },
    responses: { 201: { description: 'Template created.', schema: Success }, ...errs() },
    extensions: ext('project', 'create'), edition: 'both',
  });
  registry.registerRoute({
    method: 'patch', path: '/api/projects/templates/{templateId}',
    summary: 'Update project template',
    description: 'Updates the template name, description, or category.',
    tags: [projTag], security: [{ ApiKeyAuth: [] }],
    request: { params: TemplateIdParam, body: { schema: registry.registerSchema('ProjectTemplateUpdateBody', zOpenApi.object({
      template_name: zOpenApi.string().min(1).optional(),
      description: zOpenApi.string().optional(),
      category: zOpenApi.string().optional(),
    })) } },
    responses: { 200: { description: 'Template updated.', schema: Success }, ...errs({ 404: 'Template not found.' }) },
    extensions: ext('project', 'update'), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/projects/templates/{templateId}/apply',
    summary: 'Create project from template',
    description: 'Creates a new project from the template, copying the selected parts (phases, statuses, tasks, etc.).',
    tags: [projTag], security: [{ ApiKeyAuth: [] }],
    request: { params: TemplateIdParam, body: { schema: registry.registerSchema('ProjectTemplateApplyBody', zOpenApi.object({
      project_name: zOpenApi.string().min(1),
      client_id: zOpenApi.string().uuid(),
      start_date: zOpenApi.string().datetime().optional(),
      assigned_to: zOpenApi.string().uuid().optional(),
      options: TemplateCopyOptions.optional(),
    })) } },
    responses: { 201: { description: 'Project created from template.', schema: Success }, ...errs({ 404: 'Template not found.' }) },
    extensions: ext('project', 'create'), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/projects/templates/{templateId}/duplicate',
    summary: 'Duplicate project template',
    description: 'Creates a complete copy of the template and returns the new template id. No request body.',
    tags: [projTag], security: [{ ApiKeyAuth: [] }],
    request: { params: TemplateIdParam },
    responses: { 201: { description: 'Template duplicated.', schema: Success }, ...errs({ 404: 'Template not found.' }) },
    extensions: ext('project', 'create'), edition: 'both',
  });

  // ---- Workflow definitions ----
  const wfTag = 'Workflow Definitions';
  const WorkflowIdParam = registry.registerSchema('WorkflowDefinitionIdParam', zOpenApi.object({ workflowId: zOpenApi.string().uuid() }));
  const WorkflowVersionParams = registry.registerSchema('WorkflowDefinitionVersionParams', zOpenApi.object({
    workflowId: zOpenApi.string().uuid(),
    version: zOpenApi.string().describe('Draft version number (coerced to a positive integer).'),
  }));
  // The workflow definition is a large DSL document; modelled as an open object.
  const WorkflowDefinitionDoc = registry.registerSchema('WorkflowDefinitionDocument', zOpenApi.record(zOpenApi.unknown()).describe('Workflow definition DSL document (nodes, edges, triggers, payload schema, etc.).'));

  registry.registerRoute({
    method: 'post', path: '/api/workflow-definitions',
    summary: 'Create workflow definition',
    description: 'Creates a new workflow with a draft definition.',
    tags: [wfTag], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('WorkflowDefinitionCreateBody', zOpenApi.object({
      key: zOpenApi.string().regex(/^[a-z0-9][a-z0-9._-]*$/).optional().describe('Stable workflow key; generated when omitted.'),
      definition: WorkflowDefinitionDoc,
      payloadSchemaMode: zOpenApi.enum(['inferred', 'pinned']).optional(),
      pinnedPayloadSchemaRef: zOpenApi.string().optional(),
    })) } },
    responses: { 201: { description: 'Workflow definition created.', schema: Success }, ...errs() },
    extensions: ext('workflow', 'manage'), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/workflow-definitions/import',
    summary: 'Import a v1 workflow bundle',
    description: 'Imports a legacy v1 workflow bundle. Pass force=true (query) to overwrite an existing definition.',
    tags: [wfTag], security: [{ ApiKeyAuth: [] }],
    request: {
      query: registry.registerSchema('WorkflowImportQuery', zOpenApi.object({ force: zOpenApi.enum(['true', 'false']).optional() })),
      body: { schema: registry.registerSchema('WorkflowImportBody', zOpenApi.object({ bundle: zOpenApi.unknown().describe('Legacy v1 workflow bundle document.') })) },
    },
    responses: { 201: { description: 'Bundle imported.', schema: Success }, ...errs() },
    extensions: ext('workflow', 'admin'), edition: 'both',
  });
  registry.registerRoute({
    method: 'put', path: '/api/workflow-definitions/{workflowId}/metadata',
    summary: 'Update workflow metadata',
    description: 'Updates workflow metadata: key, visibility, pause state, concurrency limit, failure thresholds, and retention policy.',
    tags: [wfTag], security: [{ ApiKeyAuth: [] }],
    request: { params: WorkflowIdParam, body: { schema: registry.registerSchema('WorkflowMetadataBody', zOpenApi.object({
      key: zOpenApi.string().optional(),
      isVisible: zOpenApi.boolean().optional(),
      isPaused: zOpenApi.boolean().optional(),
      concurrencyLimit: zOpenApi.number().int().min(0).optional(),
      autoPauseOnFailure: zOpenApi.boolean().optional(),
      failureRateThreshold: zOpenApi.number().min(0).max(1).optional(),
      failureRateMinRuns: zOpenApi.number().int().min(0).optional(),
      retentionPolicyOverride: zOpenApi.record(zOpenApi.unknown()).optional(),
    })) } },
    responses: { 200: { description: 'Metadata updated.', schema: Success }, ...errs({ 404: 'Workflow not found.' }) },
    extensions: ext('workflow', 'publish'), edition: 'both',
  });
  registry.registerRoute({
    method: 'put', path: '/api/workflow-definitions/{workflowId}/{version}',
    summary: 'Update workflow draft definition',
    description: 'Replaces the draft definition for a specific version.',
    tags: [wfTag], security: [{ ApiKeyAuth: [] }],
    request: { params: WorkflowVersionParams, body: { schema: registry.registerSchema('WorkflowDefinitionUpdateBody', zOpenApi.object({ definition: WorkflowDefinitionDoc })) } },
    responses: { 200: { description: 'Draft updated.', schema: Success }, ...errs({ 404: 'Workflow/version not found.' }) },
    extensions: ext('workflow', 'manage'), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/workflow-definitions/{workflowId}/{version}/publish',
    summary: 'Publish a workflow version',
    description: 'Publishes the draft as an active version (auto-increments when the requested version is below the next expected). An optional definition in the body overrides the stored draft.',
    tags: [wfTag], security: [{ ApiKeyAuth: [] }],
    request: { params: WorkflowVersionParams, body: { schema: registry.registerSchema('WorkflowPublishBody', zOpenApi.object({ definition: WorkflowDefinitionDoc.optional() })) } },
    responses: { 200: { description: 'Version published.', schema: Success }, ...errs({ 404: 'Workflow/version not found.' }) },
    extensions: ext('workflow', 'publish'), edition: 'both',
  });

  // ---- Workflow runs + events ----
  const runTag = 'Workflow Runs';
  const RunIdParam = registry.registerSchema('WorkflowRunIdParam', zOpenApi.object({ runId: zOpenApi.string() }));
  const RunActionBody = registry.registerSchema('WorkflowRunActionBody', zOpenApi.object({
    reason: zOpenApi.string().optional().describe('Audit reason for the action.'),
    source: zOpenApi.string().optional().describe("Origin label; defaults to 'api'."),
  }));

  registry.registerRoute({
    method: 'post', path: '/api/workflow-runs',
    summary: 'Start a workflow run',
    description: 'Starts a workflow execution with an optional version override and input payload (payload capped ~2MB; rate-limited per tenant).',
    tags: [runTag], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('WorkflowRunCreateBody', zOpenApi.object({
      workflowId: zOpenApi.string(),
      workflowVersion: zOpenApi.number().int().positive().optional(),
      payload: zOpenApi.record(zOpenApi.unknown()).optional(),
      eventType: zOpenApi.string().optional(),
      sourcePayloadSchemaRef: zOpenApi.string().optional(),
    })) } },
    responses: { 201: { description: 'Run started.', schema: Success }, ...errs() },
    extensions: ext('workflow', 'manage'), edition: 'both',
  });

  const runAction = (action: string, summary: string, description: string, body = RunActionBody) =>
    registry.registerRoute({
      method: 'post', path: `/api/workflow-runs/{runId}/${action}`,
      summary, description,
      tags: [runTag], security: [{ ApiKeyAuth: [] }],
      request: { params: RunIdParam, body: { schema: body } },
      responses: { 200: { description: `${summary} succeeded.`, schema: Success }, ...errs({ 404: 'Run not found.' }) },
      extensions: ext('workflow', 'admin'), edition: 'both',
    });

  runAction('cancel', 'Cancel a workflow run', 'Stops the run and marks its waits as canceled.');
  runAction('replay', 'Replay a workflow run', 'Re-executes the workflow from the start with a new input payload.',
    registry.registerSchema('WorkflowRunReplayBody', zOpenApi.object({
      reason: zOpenApi.string().optional(),
      source: zOpenApi.string().optional(),
      payload: zOpenApi.record(zOpenApi.unknown()).optional(),
    })));
  runAction('requeue', 'Requeue a workflow run', 'Re-initializes the run\'s event wait (for runs stuck awaiting an external event).');
  runAction('resume', 'Resume a workflow run', 'Resolves waiting steps and resumes a paused/waiting run.');
  runAction('retry', 'Retry a failed workflow run', 'Restarts a FAILED run from its last failed node.');

  registry.registerRoute({
    method: 'post', path: '/api/workflow/events',
    summary: 'Submit a workflow event',
    description: 'Injects an event into the workflow runtime, correlating it to waiting runs by event name and correlation key.',
    tags: [runTag], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('WorkflowEventBody', zOpenApi.object({
      eventName: zOpenApi.string(),
      workflowCorrelationKey: zOpenApi.string().optional(),
      correlationKey: zOpenApi.string().optional(),
      payloadSchemaRef: zOpenApi.string().optional(),
      payload: zOpenApi.record(zOpenApi.unknown()).optional(),
    })) } },
    responses: { 200: { description: 'Event accepted.', schema: Success }, ...errs() },
    extensions: ext('workflow', 'manage'), edition: 'both',
  });

  // ---- Read endpoints for the three families (lists, get-by-id, audit, export, etc.) ----
  const EventIdParam = registry.registerSchema('WorkflowEventIdParam', zOpenApi.object({ eventId: zOpenApi.string() }));
  const readRoute = (
    path: string,
    summary: string,
    description: string,
    resource: string,
    params?: ReturnType<typeof registry.registerSchema>,
    notFound?: string,
  ) =>
    registry.registerRoute({
      method: 'get', path, summary, description,
      tags: [resource === 'project' ? projTag : (path.includes('/workflow-runs') || path.includes('/workflow/events')) ? runTag : wfTag],
      security: [{ ApiKeyAuth: [] }],
      ...(params ? { request: { params } } : {}),
      responses: { 200: { description: `${summary}.`, schema: Success }, ...errs(notFound ? { 404: notFound } : undefined) },
      extensions: ext(resource, 'read'),
      edition: 'both',
    });

  // Project templates (reads + delete)
  readRoute('/api/projects/templates', 'List project templates', 'Lists the tenant project templates.', 'project');
  readRoute('/api/projects/templates/categories', 'List project template categories', 'Lists the available project-template categories.', 'project');
  readRoute('/api/projects/templates/{templateId}', 'Get a project template', 'Returns a single project template by id.', 'project', TemplateIdParam, 'Template not found.');
  registry.registerRoute({
    method: 'delete', path: '/api/projects/templates/{templateId}',
    summary: 'Delete a project template',
    description: 'Deletes a project template by id.',
    tags: [projTag], security: [{ ApiKeyAuth: [] }],
    request: { params: TemplateIdParam },
    responses: { 204: { description: 'Template deleted.', emptyBody: true }, ...errs({ 404: 'Template not found.' }) },
    extensions: ext('project', 'delete'), edition: 'both',
  });

  // Workflow definitions (reads)
  readRoute('/api/workflow-definitions', 'List workflow definitions', 'Lists workflow definitions for the tenant.', 'workflow');
  readRoute('/api/workflow-definitions/{workflowId}/versions', 'List workflow versions', 'Lists the versions (draft and published) of a workflow definition.', 'workflow', WorkflowIdParam, 'Workflow not found.');
  readRoute('/api/workflow-definitions/{workflowId}/{version}', 'Get a workflow version', 'Returns the definition document for a specific workflow version.', 'workflow', WorkflowVersionParams, 'Workflow/version not found.');
  readRoute('/api/workflow-definitions/{workflowId}/export', 'Export a workflow definition', 'Exports the workflow definition document (JSON).', 'workflow', WorkflowIdParam, 'Workflow not found.');
  readRoute('/api/workflow-definitions/{workflowId}/audit', 'Get workflow audit log', 'Returns the audit-log entries for a workflow definition.', 'workflow', WorkflowIdParam, 'Workflow not found.');
  readRoute('/api/workflow-definitions/{workflowId}/audit/export', 'Export workflow audit log', 'Exports the workflow definition audit log.', 'workflow', WorkflowIdParam, 'Workflow not found.');

  // Workflow runs (reads)
  readRoute('/api/workflow-runs', 'List workflow runs', 'Lists workflow runs for the tenant.', 'workflow');
  readRoute('/api/workflow-runs/dead-letter', 'List dead-lettered runs', 'Lists runs that failed terminally and were moved to the dead-letter set.', 'workflow');
  readRoute('/api/workflow-runs/export', 'Export workflow runs', 'Exports workflow runs (JSON/CSV).', 'workflow');
  readRoute('/api/workflow-runs/latest', 'Get latest workflow runs', 'Returns the most recent workflow runs.', 'workflow');
  readRoute('/api/workflow-runs/summary', 'Get workflow runs summary', 'Returns aggregate run metrics across the tenant.', 'workflow');
  readRoute('/api/workflow-runs/{runId}', 'Get a workflow run', 'Returns a single workflow run by id.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/steps', 'Get workflow run steps', 'Returns the step/node states for a run.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/timeline', 'Get workflow run timeline', 'Returns the chronological event timeline for a run.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/summary', 'Get workflow run summary', 'Returns a summary of a single run.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/audit', 'Get workflow run audit log', 'Returns the audit-log entries for a run.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/audit/export', 'Export workflow run audit log', 'Exports the audit log for a run.', 'workflow', RunIdParam, 'Run not found.');
  readRoute('/api/workflow-runs/{runId}/export', 'Export a workflow run', 'Exports a single workflow run (JSON).', 'workflow', RunIdParam, 'Run not found.');

  // Workflow events (reads)
  readRoute('/api/workflow/events', 'List workflow events', 'Lists submitted workflow events for the tenant.', 'workflow');
  readRoute('/api/workflow/events/export', 'Export workflow events', 'Exports workflow events (JSON/CSV).', 'workflow');
  readRoute('/api/workflow/events/summary', 'Get workflow events summary', 'Returns aggregate workflow-event metrics.', 'workflow');
  readRoute('/api/workflow/events/{eventId}', 'Get a workflow event', 'Returns a single workflow event by id.', 'workflow', EventIdParam, 'Event not found.');

  // ---- Workflow registry (designer building blocks; read-only) ----
  const regTag = 'Workflow Registry';
  const JsonSchemaDoc = registry.registerSchema(
    'WorkflowJsonSchemaDocument',
    zOpenApi.record(zOpenApi.unknown()).describe('A JSON Schema document.'),
  );
  const WorkflowRegistryAction = registry.registerSchema(
    'WorkflowRegistryAction',
    zOpenApi.object({
      id: zOpenApi.string().describe('Stable action identifier (e.g. "ticket.create").'),
      version: zOpenApi.number().int().describe('Action version.'),
      sideEffectful: zOpenApi.boolean().describe('Whether executing the action mutates external state.'),
      retryHint: zOpenApi.record(zOpenApi.unknown()).nullable().describe('Suggested retry policy, or null.'),
      idempotency: zOpenApi.record(zOpenApi.unknown()).describe('Idempotency configuration for the action.'),
      ui: zOpenApi.record(zOpenApi.unknown()).describe('Designer UI metadata (label, group, icon, etc.).'),
      inputSchema: JsonSchemaDoc.describe('JSON Schema for the action input, annotated with designer presentation metadata.'),
      outputSchema: JsonSchemaDoc.describe('JSON Schema for the action output.'),
      examples: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).nullable().describe('Example invocations, or null.'),
    }),
  );
  const WorkflowRegistryNode = registry.registerSchema(
    'WorkflowRegistryNode',
    zOpenApi.object({
      id: zOpenApi.string().describe('Node type identifier.'),
      ui: zOpenApi.record(zOpenApi.unknown()).describe('Designer UI metadata for the node.'),
      configSchema: JsonSchemaDoc.describe('JSON Schema for the node configuration.'),
      examples: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).nullable().describe('Example configurations, or null.'),
      defaultRetry: zOpenApi.record(zOpenApi.unknown()).nullable().describe('Default retry policy for the node, or null.'),
    }),
  );

  registry.registerRoute({
    method: 'get', path: '/api/workflow/registry/actions',
    summary: 'List workflow registry actions',
    description: 'Lists every action registered in the workflow runtime — the building blocks workflow definitions can invoke — including JSON Schemas for each action\'s input and output. Returns a bare array (no envelope).',
    tags: [regTag], security: [{ ApiKeyAuth: [] }],
    responses: { 200: { description: 'Registered actions.', schema: zOpenApi.array(WorkflowRegistryAction) }, ...errs() },
    extensions: ext('workflow', 'read'), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/workflow/registry/nodes',
    summary: 'List workflow registry node types',
    description: 'Lists the node types available to workflow definitions (triggers, control flow, action nodes, etc.) with each node\'s configuration JSON Schema and default retry policy. Returns a bare array (no envelope).',
    tags: [regTag], security: [{ ApiKeyAuth: [] }],
    responses: { 200: { description: 'Registered node types.', schema: zOpenApi.array(WorkflowRegistryNode) }, ...errs() },
    extensions: ext('workflow', 'read'), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/workflow/registry/designer-catalog',
    summary: 'Get the workflow designer action catalog',
    description: 'Returns the action catalog the workflow designer renders: registry actions and integration modules grouped into tiles, filtered to the integrations actually available to the tenant. Returns a bare array of catalog records (no envelope).',
    tags: [regTag], security: [{ ApiKeyAuth: [] }],
    responses: { 200: { description: 'Designer catalog tiles.', schema: zOpenApi.array(zOpenApi.record(zOpenApi.unknown()).describe('Catalog tile (groupKey, tileKind, actions, UI metadata).')) }, ...errs() },
    extensions: ext('workflow', 'read'), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/workflow/registry/schemas/{schemaRef}',
    summary: 'Get a workflow schema by ref',
    description: 'Resolves a registered workflow schema reference (URL-encoded) to its JSON Schema document.',
    tags: [regTag], security: [{ ApiKeyAuth: [] }],
    request: { params: registry.registerSchema('WorkflowSchemaRefParam', zOpenApi.object({
      schemaRef: zOpenApi.string().describe('Registered schema reference; URL-encode it in the path.'),
    })) },
    responses: {
      200: { description: 'Resolved schema.', schema: registry.registerSchema('WorkflowSchemaResponse', zOpenApi.object({
        ref: zOpenApi.string().describe('The resolved schema reference.'),
        schema: JsonSchemaDoc,
      })) },
      ...errs({ 404: 'Unknown schema ref.' }),
    },
    extensions: ext('workflow', 'read'), edition: 'both',
  });

  // ---- Projects (unversioned list used by the UI; distinct from /api/v1/projects) ----
  registry.registerRoute({
    method: 'get', path: '/api/projects',
    summary: 'List projects',
    description: 'Lists all projects for the tenant. Returns a bare array of project records (no envelope); responds 403 with an error message when the caller lacks project read permission.',
    tags: ['Projects'], security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Projects for the tenant.', schema: zOpenApi.array(zOpenApi.record(zOpenApi.unknown()).describe('Project record.')) },
      ...errs(),
    },
    extensions: ext('project', 'read'), edition: 'both',
  });
}
