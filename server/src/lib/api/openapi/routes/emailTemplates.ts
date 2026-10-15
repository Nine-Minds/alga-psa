import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { LOCALE_CONFIG } from '@alga-psa/core/i18n/config';

export function registerEmailTemplateRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tags = ['Email Templates', 'Notifications'];
  const languageEnum = zOpenApi.enum(LOCALE_CONFIG.supportedLocales as unknown as [string, ...string[]]);

  const EmailTemplateNameParams = registry.registerSchema(
    'EmailTemplateNameParams',
    zOpenApi.object({
      name: zOpenApi
        .string()
        .describe('Kebab-case template name, such as ticket-created or invoice-email.'),
    }),
  );

  const EmailTemplateListQuery = registry.registerSchema(
    'EmailTemplateListQuery',
    zOpenApi.object({
      name: zOpenApi.string().optional().describe('Filter to a single template name.'),
      language: languageEnum.optional().describe('Filter to one language code.'),
      category: zOpenApi.string().optional().describe('Filter by notification category name.'),
      customized: zOpenApi
        .enum(['true', 'false'])
        .optional()
        .describe('Filter to templates the tenant has customized (true) or not (false).'),
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(100).optional(),
    }),
  );

  const EmailTemplateDetailQuery = registry.registerSchema(
    'EmailTemplateDetailQuery',
    zOpenApi.object({
      language: languageEnum
        .optional()
        .describe('Language code to read. Defaults to the first language the template exists in.'),
    }),
  );

  const EmailTemplateDeleteQuery = registry.registerSchema(
    'EmailTemplateDeleteQuery',
    zOpenApi.object({
      language: languageEnum.describe('Language code whose tenant override is removed.'),
    }),
  );

  const EmailTemplateSummary = registry.registerSchema(
    'EmailTemplateSummary',
    zOpenApi.object({
      name: zOpenApi.string().describe('Template name, shared by the system default and the tenant override.'),
      language_code: zOpenApi.string().describe('Language code of this row.'),
      category: zOpenApi.string().nullable().describe('Notification category the template belongs to.'),
      subject: zOpenApi.string().describe('Subject line that would be sent today.'),
      is_customized: zOpenApi.boolean().describe('Whether the tenant has an override for this name and language.'),
      system_template_id: zOpenApi.number().int().nullable(),
      tenant_template_id: zOpenApi.number().int().nullable(),
      updated_at: zOpenApi.string().nullable().describe('When the tenant override was last written.'),
    }).describe('One email template, system default and tenant override merged.'),
  );

  const EmailTemplateBody = zOpenApi.object({
    id: zOpenApi.number().int(),
    subject: zOpenApi.string(),
    html_content: zOpenApi.string(),
    text_content: zOpenApi.string(),
  });

  const EmailTemplateDetail = registry.registerSchema(
    'EmailTemplateDetail',
    EmailTemplateSummary.extend({
      system: EmailTemplateBody.nullable().describe('The read-only system default.'),
      tenant: EmailTemplateBody.nullable().describe('The tenant override, when one exists.'),
      effective: zOpenApi.object({
        subject: zOpenApi.string(),
        html_content: zOpenApi.string(),
        text_content: zOpenApi.string(),
      }).describe('What actually ships: the override when present, otherwise the system default.'),
    }),
  );

  const EmailTemplateEnvelope = registry.registerSchema(
    'EmailTemplateEnvelope',
    zOpenApi.object({
      data: EmailTemplateDetail,
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const PaginatedEmailTemplateEnvelope = registry.registerSchema(
    'PaginatedEmailTemplateEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(EmailTemplateSummary),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const EmailTemplateUpdateRequest = registry.registerSchema(
    'EmailTemplateUpdateRequest',
    zOpenApi.object({
      language_code: languageEnum.describe('Language of the template being edited.'),
      subject: zOpenApi.string().min(1).max(998).optional().describe('New subject line. Supports {{variable}} placeholders.'),
      html_content: zOpenApi.string().min(1).optional().describe('New HTML body. Supports {{variable}} placeholders.'),
      text_content: zOpenApi.string().min(1).optional().describe('New plain-text body.'),
    }).describe('Fields to write onto the tenant override. At least one of subject, html_content or text_content is required.'),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/email/templates',
    summary: 'List email templates',
    description:
      'Returns every notification email template available to the tenant, with the system default and the tenant override merged into one row per name and language. Use is_customized to tell which templates the tenant has edited.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: EmailTemplateListQuery,
    },
    responses: {
      200: {
        description: 'Email templates returned successfully.',
        schema: PaginatedEmailTemplateEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the settings read permission.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'settings',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Email Templates',
      'x-chat-rbac-resource': 'settings',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/email/templates/{name}',
    summary: 'Get email template',
    description:
      'Returns one email template: the read-only system default, the tenant override when there is one, and the effective content that would be sent.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: EmailTemplateNameParams,
      query: EmailTemplateDetailQuery,
    },
    responses: {
      200: {
        description: 'Email template returned successfully.',
        schema: EmailTemplateEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the settings read permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'No template with that name and language.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'settings',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Email Template',
      'x-chat-rbac-resource': 'settings',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/email/templates/{name}',
    summary: 'Update email template',
    description:
      'Writes the tenant override for one template and language. The first write clones the system default, then applies the fields provided, so unspecified fields keep the standard content. System templates themselves are never modified.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: EmailTemplateNameParams,
      body: {
        schema: EmailTemplateUpdateRequest,
        description: 'Template fields to write.',
      },
    },
    responses: {
      200: {
        description: 'Email template updated successfully.',
        schema: EmailTemplateEnvelope,
      },
      400: {
        description: 'Validation error.',
        schema: deps.ErrorResponse,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the settings update permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'No template with that name and language.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'settings',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Email Template',
      'x-chat-rbac-resource': 'settings',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/email/templates/{name}',
    summary: 'Reset email template',
    description:
      'Removes the tenant override for one template and language, so the standard template is used again. Other languages of the same template are untouched.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: EmailTemplateNameParams,
      query: EmailTemplateDeleteQuery,
    },
    responses: {
      204: {
        description: 'Tenant override removed successfully.',
        emptyBody: true,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the settings update permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'The template is not customized for that language.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'settings',
      'x-chat-callable': true,
      'x-chat-display-name': 'Reset Email Template',
      'x-chat-rbac-resource': 'settings',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
