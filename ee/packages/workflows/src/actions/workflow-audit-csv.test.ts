import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_AUDIT_CSV_HEADERS,
  buildCsv,
  buildWorkflowAuditCsvRows,
  formatActor,
  type WorkflowAuditCsvEnrichment,
  type WorkflowAuditCsvLog
} from './workflow-audit-csv';

const baseEnrichment: WorkflowAuditCsvEnrichment = {
  actorByUserId: new Map(),
  context: {
    workflowId: 'wf-1',
    runId: null,
    workflowName: 'Onboarding',
    workflowKey: 'onboarding',
    workflowVersion: 7,
    runStatus: null
  }
};

describe('workflowAuditCsv formatter', () => {
  it('T001: formats workflow definition audit rows with readable columns and trailing ids', () => {
    const logs: WorkflowAuditCsvLog[] = [
      {
        audit_id: 'a-1',
        timestamp: '2026-04-29T10:00:00.000Z',
        operation: 'workflow_definition_publish',
        user_id: 'u-1',
        table_name: 'workflow_definitions',
        record_id: 'wf-1',
        changed_data: { published_version: 12 },
        details: { source: 'ui', reason: 'Approved for prod' }
      }
    ];
    const enrichment: WorkflowAuditCsvEnrichment = {
      ...baseEnrichment,
      actorByUserId: new Map([['u-1', 'Alice Smith <alice@example.com>']])
    };

    const [row] = buildWorkflowAuditCsvRows(logs, enrichment);

    expect(Object.keys(row)).toEqual([...WORKFLOW_AUDIT_CSV_HEADERS]);
    expect(row.event).toBe('Workflow published');
    expect(row.actor).toBe('Alice Smith <alice@example.com>');
    expect(row.workflow_name).toBe('Onboarding');
    expect(row.workflow_key).toBe('onboarding');
    expect(row.workflow_version).toBe('12');
    expect(row.changed_fields).toContain('published version');
    expect(row.summary).toContain('Workflow published');
    expect(row.workflow_id).toBe('wf-1');
    expect(row.operation).toBe('workflow_definition_publish');
    expect(row.audit_id).toBe('a-1');
  });

  it('T004: falls back unknown operation and keeps safe additional details summaries', () => {
    const logs: WorkflowAuditCsvLog[] = [
      {
        audit_id: 'a-2',
        timestamp: '2026-04-29T10:00:00.000Z',
        operation: 'workflow_run_custom_probe',
        user_id: null,
        table_name: 'workflow_runs',
        record_id: 'run-1',
        changed_data: { custom_scalar: 'value', warnings: [1, 2], trigger: { a: true } },
        details: null
      }
    ];

    const [row] = buildWorkflowAuditCsvRows(logs, {
      actorByUserId: new Map(),
      context: {
        workflowId: 'wf-1',
        runId: 'run-1',
        workflowName: 'Onboarding',
        workflowKey: 'onboarding',
        workflowVersion: 2,
        runStatus: 'running'
      }
    });

    expect(row.event).toBe('Workflow Run Custom Probe');
    expect(row.actor).toBe('system');
    expect(row.additional_details).toContain('custom_scalar=value');
    expect(row.additional_details).toContain('warnings=2 items');
    expect(row.additional_details).toContain('trigger=object');
  });

  it('T005/T006: keeps redacted text and escapes csv-sensitive values', () => {
    const logs: WorkflowAuditCsvLog[] = [
      {
        audit_id: 'a-3',
        timestamp: '2026-04-29T10:00:00.000Z',
        operation: 'workflow_run_cancel',
        user_id: 'u-2',
        table_name: 'workflow_runs',
        record_id: 'run-2',
        changed_data: { reason: '***', note: 'line1\nline2' },
        details: { source: 'api,client', quote: '"quoted"' }
      }
    ];

    const [row] = buildWorkflowAuditCsvRows(logs, {
      actorByUserId: new Map([['u-2', 'Bob, Ops <bob@example.com>']]),
      context: {
        workflowId: 'wf-2',
        runId: 'run-2',
        workflowName: 'Ops "Runbook"',
        workflowKey: 'ops',
        workflowVersion: 3,
        runStatus: 'canceled'
      }
    });

    expect(row.reason).toBe('***');
    expect(row.additional_details).toContain('note=line1\nline2');
    expect(row.additional_details).toContain('quote="quoted"');

    const csv = buildCsv(WORKFLOW_AUDIT_CSV_HEADERS, [WORKFLOW_AUDIT_CSV_HEADERS.map((h) => row[h])]);
    expect(csv).toContain('"Bob, Ops <bob@example.com>"');
    expect(csv).toContain('"Ops ""Runbook"""');
    expect(csv).toContain('"note=line1\nline2; quote=""quoted"""');
  });

  it('T007: formatActor handles full/email/name/system unresolved shapes', () => {
    expect(formatActor({ user_id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.com' })).toBe('A B <a@b.com>');
    expect(formatActor({ user_id: 'u2', first_name: '', last_name: '', email: 'a@b.com' })).toBe('a@b.com');
    expect(formatActor({ user_id: 'u3', first_name: 'A', last_name: 'B', email: '' })).toBe('A B');
    expect(formatActor({ user_id: 'u4', first_name: '', last_name: '', email: '' })).toBe('Unresolved user');
    expect(formatActor(undefined)).toBe('Unresolved user');
  });
});
