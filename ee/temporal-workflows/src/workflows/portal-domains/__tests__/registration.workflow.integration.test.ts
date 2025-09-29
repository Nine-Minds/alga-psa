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

    let currentStatus = record.status;

    const markStatus = async ({ status, statusMessage }: { status: string; statusMessage?: string | null }) => {
      currentStatus = status;
      statusUpdates.push({ status, statusMessage: statusMessage ?? null });
    };

    const activities = {
      loadPortalDomain: async ({ portalDomainId }: { portalDomainId: string }) => {
        expect(portalDomainId).toBe(record.id);
        return { ...record, status: currentStatus };
      },
      markPortalDomainStatus: markStatus,
      verifyCnameRecord: async ({ expectedCname }: { expectedCname: string }) => ({
        matched: true,
        observed: [expectedCname],
        message: 'CNAME verified by test double.',
      }),
      applyPortalDomainResources: async () => ({
        success: false,
        appliedCount: 0,
        errors: ['cert-manager failed to register SSL certificate with the ACME server'],
      }),
      checkPortalDomainDeploymentStatus: async () => ({
        status: currentStatus,
        statusMessage: statusUpdates[statusUpdates.length - 1]?.statusMessage ?? null,
      }),
      deletePortalDomainRecord: async () => {},
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
      expect(failureStatus.statusMessage).toContain('Failed to apply Kubernetes resources');
      expect(failureStatus.statusMessage).toContain('ACME');
    } finally {
      await env.teardown();
    }
  });

  it('moves the domain to deploying after applying resources', async () => {
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

    let currentStatus = record.status;
    let loadCount = 0;

    const markStatus = async ({ status, statusMessage }: { status: string; statusMessage?: string | null }) => {
      currentStatus = status;
      if (status === 'deploying') {
        loadCount = 0;
      }
      statusUpdates.push({ status, statusMessage: statusMessage ?? null });
    };

    const activities = {
      loadPortalDomain: async ({ portalDomainId }: { portalDomainId: string }) => {
        expect(portalDomainId).toBe(record.id);
        loadCount += 1;
        return { ...record, status: currentStatus };
      },
      markPortalDomainStatus: markStatus,
      verifyCnameRecord: async ({ expectedCname }: { expectedCname: string }) => ({
        matched: true,
        observed: [expectedCname],
        message: 'CNAME verified by test double.',
      }),
      applyPortalDomainResources: async () => ({
        success: true,
        appliedCount: 3,
        errors: [],
      }),
      checkPortalDomainDeploymentStatus: async () => {
        if (currentStatus === 'deploying') {
          await markStatus({
            status: 'certificate_issuing',
            statusMessage: 'Certificate issuance in progress.',
          });
        } else if (currentStatus === 'certificate_issuing') {
          await markStatus({
            status: 'active',
            statusMessage: 'Certificate issued and routing configured.',
          });
        }

        return {
          status: currentStatus,
          statusMessage: statusUpdates[statusUpdates.length - 1]?.statusMessage ?? null,
        };
      },
      deletePortalDomainRecord: async () => {},
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
        'certificate_issuing',
        'active',
      ]);

      const lastStatus = statusUpdates[statusUpdates.length - 1];
      expect(lastStatus.statusMessage).toContain('Certificate issued');
    } finally {
      await env.teardown();
    }
  });

  it('retries after a failure and succeeds on the next attempt', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-portal-domain-${Date.now()}-retry`;
    const statusUpdates: Array<{ status: string; statusMessage: string | null }> = [];

    const record: PortalDomainActivityRecord = {
      id: 'domain-retry',
      tenant: 'tenant-retry',
      domain: 'retry.example.com',
      canonical_host: 'tenantretry.portal.algapsa.com',
      status: 'pending_dns',
      status_message: null,
      verification_details: { expected_cname: 'tenantretry.portal.algapsa.com' },
      certificate_secret_name: null,
      last_synced_resource_version: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let currentStatus = record.status;
    let applyAttempts = 0;
    let loadCount = 0;
    let resolveFailureSignal: (() => void) | null = null;
    const failureDetected = new Promise<void>((resolve) => {
      resolveFailureSignal = resolve;
    });

    const markStatus = async ({ status, statusMessage }: { status: string; statusMessage?: string | null }) => {
      currentStatus = status;
      if (status === 'deploying') {
        loadCount = 0;
      }
      statusUpdates.push({ status, statusMessage: statusMessage ?? null });
      if (status === 'certificate_failed' && resolveFailureSignal) {
        resolveFailureSignal();
        resolveFailureSignal = null;
      }
    };

    const activities = {
      loadPortalDomain: async ({ portalDomainId }: { portalDomainId: string }) => {
        expect(portalDomainId).toBe(record.id);
        loadCount += 1;
        return { ...record, status: currentStatus };
      },
      markPortalDomainStatus: markStatus,
      verifyCnameRecord: async ({ expectedCname }: { expectedCname: string }) => ({
        matched: true,
        observed: [expectedCname],
        message: 'CNAME verified by test double.',
      }),
      applyPortalDomainResources: async () => {
        applyAttempts += 1;
        if (applyAttempts === 1) {
          return {
            success: false,
            appliedCount: 0,
            errors: ['cert-manager failed to register SSL certificate with the ACME server'],
          };
        }
        return {
          success: true,
          appliedCount: 3,
          errors: [],
        };
      },
      checkPortalDomainDeploymentStatus: async () => {
        if (currentStatus === 'deploying') {
          await markStatus({
            status: 'certificate_issuing',
            statusMessage: 'Retrying certificate issuance.',
          });
        } else if (currentStatus === 'certificate_issuing') {
          await markStatus({
            status: 'active',
            statusMessage: 'Certificate issued and routing configured after retry.',
          });
        }

        return {
          status: currentStatus,
          statusMessage: statusUpdates[statusUpdates.length - 1]?.statusMessage ?? null,
        };
      },
      deletePortalDomainRecord: async () => {},
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

        await failureDetected;

        await handle.signal('reconcilePortalDomainState', { trigger: 'refresh', portalDomainId: record.id, tenantId: record.tenant });

        await handle.result();
      });

      expect(statusUpdates.map((entry) => entry.status)).toEqual([
        'verifying_dns',
        'pending_certificate',
        'certificate_failed',
        'verifying_dns',
        'pending_certificate',
        'deploying',
        'certificate_issuing',
        'active',
      ]);

      const lastStatus = statusUpdates[statusUpdates.length - 1];
      expect(lastStatus.statusMessage).toContain('Certificate issued');
    } finally {
      await env.teardown();
    }
  });
});
