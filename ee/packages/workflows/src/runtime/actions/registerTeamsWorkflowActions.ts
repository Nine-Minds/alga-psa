import { z } from 'zod';
import type { Knex } from 'knex';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { throwActionError } from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerIntegrationWorkflowModule } from '../integrationModules';
import type { TeamsActivityType, TeamsIntegrationContext } from './teamsWorkflowRuntimeSupport';

const loadTeamsRuntimeSupport = () => import('./teamsWorkflowRuntimeSupport');

const TEAMS_ADDON_KEY = 'teams';

const CATEGORY_TO_ACTIVITY_TYPE: Record<string, TeamsActivityType> = {
  assignment: 'assignmentCreated',
  customer_reply: 'customerReplyReceived',
  approval_request: 'approvalRequested',
  escalation: 'workEscalated',
  sla_risk: 'slaRiskDetected'
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeStringArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];

const parseJsonish = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const errorStatus = (error: unknown): number | undefined =>
  error instanceof Error ? (error as { status?: number }).status : undefined;

export async function tenantHasActiveTeamsAddOn(knex: Knex, tenantId: string): Promise<boolean> {
  const row = await knex('tenant_addons')
    .where({ tenant: tenantId, addon_key: TEAMS_ADDON_KEY })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');
  return Boolean(row);
}

export async function teamsIntegrationAvailability(knex: Knex, tenantId: string): Promise<boolean> {
  if (!(await tenantHasActiveTeamsAddOn(knex, tenantId))) return false;
  const integration = await knex('teams_integrations').where({ tenant: tenantId }).first();
  return normalizeString(integration?.install_status) === 'active';
}

async function requireTeamsIntegration(ctx: ActionContext): Promise<{
  tenantId: string;
  knex: any;
  context: TeamsIntegrationContext;
}> {
  const tenantId = ctx.tenantId ?? null;
  if (!tenantId) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'tenantId is required' });
  }
  const knex = ctx.knex;
  if (!knex) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Database connection unavailable' });
  }

  if (!(await tenantHasActiveTeamsAddOn(knex, tenantId))) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_INACTIVE',
      message: 'The Teams add-on is not active for this tenant.'
    });
  }

  const integration = await knex('teams_integrations').where({ tenant: tenantId }).first();
  if (!integration || normalizeString(integration.install_status) !== 'active') {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_INACTIVE',
      message: 'The Teams integration is not installed and active for this tenant. Configure it under Settings > Integrations.'
    });
  }

  const selectedProfileId = normalizeString(integration.selected_profile_id);
  const appId = normalizeString(integration.app_id);
  const packageMetadata = parseJsonish(integration.package_metadata) as { baseUrl?: unknown } | null;
  const baseUrl = normalizeString(packageMetadata?.baseUrl);
  if (!selectedProfileId || !appId || !baseUrl) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_MISCONFIGURED',
      message: 'The Teams integration is missing its Microsoft profile, app ID, or package base URL.'
    });
  }

  const profile = await knex('microsoft_profiles')
    .where({ tenant: tenantId, profile_id: selectedProfileId })
    .first();
  if (!profile || profile.is_archived) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_MISCONFIGURED',
      message: 'The Microsoft profile selected for Teams is missing or archived.'
    });
  }

  return {
    tenantId,
    knex,
    context: {
      appId,
      baseUrl,
      profile: {
        clientId: String(profile.client_id),
        tenantAuthority: String(profile.tenant_id),
        clientSecretRef: String(profile.client_secret_ref)
      }
    }
  };
}

async function resolveMicrosoftAccountId(knex: Knex, tenantId: string, userId: string): Promise<string | null> {
  const row = await knex('user_auth_accounts')
    .where({ tenant: tenantId, user_id: userId, provider: 'microsoft' })
    .orderBy('linked_at', 'desc')
    .first('provider_account_id');
  const accountId = normalizeString(row?.provider_account_id);
  return accountId || null;
}

async function getLatestConversationReference(
  knex: Knex,
  tenantId: string,
  microsoftUserId: string,
  conversationType: 'personal' | 'groupChat' | 'channel'
): Promise<{ conversationId: string; serviceUrl: string } | null> {
  const row = await knex('teams_conversation_references')
    .where({ tenant: tenantId, microsoft_user_id: microsoftUserId, conversation_type: conversationType })
    .orderBy('last_activity_at', 'desc')
    .first(['conversation_id', 'service_url']);
  if (!row?.conversation_id || !row?.service_url) return null;
  return { conversationId: String(row.conversation_id), serviceUrl: String(row.service_url) };
}

async function getAnyTenantServiceUrl(knex: Knex, tenantId: string): Promise<string | null> {
  const row = await knex('teams_conversation_references')
    .where({ tenant: tenantId })
    .orderBy('last_activity_at', 'desc')
    .first('service_url');
  const serviceUrl = normalizeString(row?.service_url);
  return serviceUrl || null;
}

let teamsRegistered = false;

export function registerTeamsWorkflowActionsV2(): void {
  if (teamsRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'teams.notify_user',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      user_id: z.string().uuid(),
      title: z.string().trim().min(1),
      message: z.string().trim().min(1).optional(),
      link: z.string().url().optional(),
      category: z.enum(['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk']).default('escalation')
    }),
    outputSchema: z.object({
      delivered: z.boolean(),
      user_id: z.string(),
      activity_type: z.string()
    }),
    ui: {
      label: 'Notify user',
      description: "Send a Teams activity-feed notification to an Alga user's linked Microsoft account.",
      category: 'Teams',
      icon: 'teams'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, context } = await requireTeamsIntegration(ctx);

      const integration = await knex('teams_integrations').where({ tenant: tenantId }).first('enabled_capabilities');
      const capabilities = normalizeStringArray(parseJsonish(integration?.enabled_capabilities));
      if (!capabilities.includes('activity_notifications')) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'CAPABILITY_DISABLED',
          message: 'Activity notifications are disabled for the Teams integration.'
        });
      }

      const recipientAadId = await resolveMicrosoftAccountId(knex, tenantId, input.user_id);
      if (!recipientAadId) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'USER_NOT_LINKED',
          message: 'The target user has no linked Microsoft account, so Teams cannot notify them.'
        });
      }

      const support = await loadTeamsRuntimeSupport();
      const graphToken = await support.fetchGraphAppToken(context, tenantId);
      const activityType = CATEGORY_TO_ACTIVITY_TYPE[input.category ?? 'escalation'];
      const webUrl = support.buildGenericTeamsDeepLink(context.baseUrl, context.appId, input.link ?? null);

      try {
        await support.sendActivityNotification({
          graphToken,
          recipientAadId,
          activityType,
          topicText: input.title,
          webUrl,
          previewText: input.message ?? input.title,
          itemName: input.title
        });
      } catch (error) {
        const status = errorStatus(error);
        if (status === 404) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Microsoft Graph could not find the recipient, or the Teams app is not installed for them.'
          });
        }
        throw error;
      }

      return { delivered: true, user_id: input.user_id, activity_type: activityType };
    }
  });

  registry.register({
    id: 'teams.send_dm',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      user_id: z.string().uuid(),
      message: z.string().trim().min(1)
    }),
    outputSchema: z.object({
      sent: z.boolean(),
      user_id: z.string(),
      conversation_id: z.string()
    }),
    ui: {
      label: 'Send direct message',
      description: 'Send a proactive bot message to a user who has opened the Alga app in Teams.',
      category: 'Teams',
      icon: 'teams'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex } = await requireTeamsIntegration(ctx);

      const microsoftUserId = await resolveMicrosoftAccountId(knex, tenantId, input.user_id);
      if (!microsoftUserId) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'USER_NOT_LINKED',
          message: 'The target user has no linked Microsoft account, so Teams cannot message them.'
        });
      }

      const reference = await getLatestConversationReference(knex, tenantId, microsoftUserId, 'personal');
      if (!reference) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'NO_CONVERSATION',
          message: 'The target user has never opened the Alga bot in Teams, so there is no conversation to message.'
        });
      }

      const support = await loadTeamsRuntimeSupport();
      await support.sendConversationMessage({
        serviceUrl: reference.serviceUrl,
        conversationId: reference.conversationId,
        text: input.message
      });

      return { sent: true, user_id: input.user_id, conversation_id: reference.conversationId };
    }
  });

  registry.register({
    id: 'teams.post_to_channel',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      channel_id: z.string().trim().min(1),
      message: z.string().trim().min(1),
      service_url: z.string().url().optional()
    }),
    outputSchema: z.object({
      posted: z.boolean(),
      channel_id: z.string(),
      conversation_id: z.string().nullable()
    }),
    ui: {
      label: 'Post to channel',
      description: 'Post a message to a channel of a team where the Alga Teams app is installed.',
      category: 'Teams',
      icon: 'teams'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex } = await requireTeamsIntegration(ctx);

      const serviceUrl = input.service_url ?? (await getAnyTenantServiceUrl(knex, tenantId));
      if (!serviceUrl) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'NO_SERVICE_URL',
          message:
            'No Teams service URL is known for this tenant yet. Install the Alga app in a team (or have a user open the bot) so Teams sends one, or pass service_url explicitly.'
        });
      }

      const support = await loadTeamsRuntimeSupport();
      try {
        const result = await support.createChannelConversation({
          serviceUrl,
          channelId: input.channel_id,
          text: input.message
        });
        return { posted: true, channel_id: input.channel_id, conversation_id: result.conversationId };
      } catch (error) {
        const status = errorStatus(error);
        if (status === 403 || status === 404) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'APP_NOT_IN_TEAM',
            message:
              'Teams rejected the post: the Alga app is not installed in that team, or the channel ID is wrong. Install the app in the team and use the channel\'s 19:…@thread.tacv2 ID.'
          });
        }
        throw error;
      }
    }
  });

  teamsRegistered = true;
}

export function registerTeamsWorkflowModule(): void {
  registerIntegrationWorkflowModule({
    module: {
      groupKey: 'app:teams',
      label: 'Microsoft Teams',
      description: 'Teams actions for activity notifications, bot messages, and channel posts.',
      tileKind: 'app',
      iconToken: 'teams',
      defaultActionId: 'teams.notify_user',
      allowedActionIds: ['teams.notify_user', 'teams.send_dm', 'teams.post_to_channel'],
      availabilityKey: 'integration:teams'
    },
    availability: teamsIntegrationAvailability,
    registerActions: () => registerTeamsWorkflowActionsV2()
  });
}
