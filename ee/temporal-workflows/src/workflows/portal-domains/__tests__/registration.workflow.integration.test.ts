import path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import type { PortalDomainActivityRecord } from '../types.js';
import { portalDomainRegistrationWorkflow } from '../registration.workflow.js';

describe('portalDomainRegistrationWorkflow', () => {
  it('marks the domain as certificate_failed when ACME registration fails', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-portal-domain-${Date.now()}`;
    const statusUpdates: Array<{ status: string; statusMessage: string | null }> = [];

    const record: PortalDomainActivityRecord = {
      id: 'domain-123',
      tenant: 'tenant-123',
      domain: 'customer.example.com',
      canonical_host: 'tenant123.portal.algapsa.com',
      status: 'pending_dns',
      status_message: null,
      verification_details: { expected_cname: 'tenant123.portal.algapsa.com' },
      certificate_secret_name: null,
      last_synced_resource_version: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const activities = {
      loadPortalDomain: async ({ portalDomainId }: { portalDomainId: string }) => {
        expect(portalDomainId).toBe(record.id);
        return record;
      },
      markPortalDomainStatus: async ({ status, statusMessage }: { status: string; statusMessage?: string | null }) => {
        statusUpdates.push({ status, statusMessage: statusMessage ?? null });
      },
      verifyCnameRecord: async ({ expectedCname }: { expectedCname: string }) => ({
        matched: true,
        observed: [expectedCname],
        message: 'CNAME verified by test double.',
      }),
      reconcilePortalDomains: async () => ({
        success: false,
        appliedCount: 0,
        errors: ['cert-manager failed to register SSL certificate with the ACME server'],
      }),
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../..'),
      activities,
    });

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(portalDomainRegistrationWorkflow, {
          args: [{ tenantId: record.tenant, portalDomainId: record.id }],
          taskQueue,
          workflowId: `portal-domain-${record.id}`,
        });

        await handle.result();
      });

      expect(statusUpdates.map((entry) => entry.status)).toEqual([
        'verifying_dns',
        'pending_certificate',
        'certificate_failed',
      ]);

      const failureStatus = statusUpdates[statusUpdates.length - 1];
      expect(failureStatus.statusMessage).toContain('Failed to reconcile Kubernetes resources');
      expect(failureStatus.statusMessage).toContain('ACME');
    } finally {
      await env.teardown();
    }
  });

  it('moves the domain to deploying after successful reconciliation', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-portal-domain-${Date.now()}-success`;
    const statusUpdates: Array<{ status: string; statusMessage: string | null }> = [];

    const record: PortalDomainActivityRecord = {
      id: 'domain-success',
      tenant: 'tenant-success',
      domain: 'success.example.com',
      canonical_host: 'tenantok.portal.algapsa.com',
      status: 'pending_dns',
      status_message: null,
      verification_details: { expected_cname: 'tenantok.portal.algapsa.com' },
      certificate_secret_name: null,
      last_synced_resource_version: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const activities = {
      loadPortalDomain: async ({ portalDomainId }: { portalDomainId: string }) => {
        expect(portalDomainId).toBe(record.id);
        return record;
      },
      markPortalDomainStatus: async ({ status, statusMessage }: { status: string; statusMessage?: string | null }) => {
        statusUpdates.push({ status, statusMessage: statusMessage ?? null });
      },
      verifyCnameRecord: async ({ expectedCname }: { expectedCname: string }) => ({
        matched: true,
        observed: [expectedCname],
        message: 'CNAME verified by test double.',
      }),
      reconcilePortalDomains: async () => ({
        success: true,
        appliedCount: 3,
        errors: [],
      }),
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../..'),
      activities,
    });

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(portalDomainRegistrationWorkflow, {
          args: [{ tenantId: record.tenant, portalDomainId: record.id }],
          taskQueue,
          workflowId: `portal-domain-${record.id}`,
        });

        await handle.result();
      });

      expect(statusUpdates.map((entry) => entry.status)).toEqual([
        'verifying_dns',
        'pending_certificate',
        'deploying',
      ]);

      const deployingStatus = statusUpdates[statusUpdates.length - 1];
      expect(deployingStatus.statusMessage).toContain('Resources applied. Waiting for certificate and gateway readiness.');
    } finally {
      await env.teardown();
    }
  });
});
