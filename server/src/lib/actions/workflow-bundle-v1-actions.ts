'use server';

import { z } from 'zod';
import { createTenantKnex } from 'server/src/lib/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { exportWorkflowBundleV1ForWorkflowId } from 'server/src/lib/workflow/bundle/exportWorkflowBundleV1';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';

const WorkflowIdInput = z.object({ workflowId: z.string().min(1) });

type AuthUser = Parameters<Parameters<typeof withAuth>[0]>[0];

const throwHttpError = (status: number, message: string): never => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
};

const requireWorkflowPermission = async (
  user: AuthUser,
  action: 'read' | 'manage' | 'publish' | 'admin',
  knex?: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  const allowed = await hasPermission(user, 'workflow', action, knex);
  if (!allowed) {
    throwHttpError(403, `Workflow permission "${action}" required`);
  }
};

export const exportWorkflowBundleV1Action = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = WorkflowIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);
  return exportWorkflowBundleV1ForWorkflowId(knex, tenant, parsed.workflowId);
});

export const importWorkflowBundleV1Action = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = z.object({ bundle: z.unknown(), force: z.boolean().optional() }).parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);
  return importWorkflowBundleV1(knex, tenant, parsed.bundle, { force: parsed.force, actorUserId: user.user_id });
});
