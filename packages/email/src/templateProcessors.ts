import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import Handlebars from 'handlebars';
import { SupportedLocale } from './lib/localeConfig';

const SYSTEM_EMAIL_TEMPLATE_LOOKUP_TENANT = '__system_email_template_lookup__';

export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateProcessorOptions {
  tenantId?: string;
  templateData?: Record<string, any>;
  locale?: SupportedLocale;
}

/**
 * Base interface for all template processors
 */
export interface ITemplateProcessor {
  process(options: TemplateProcessorOptions): Promise<EmailTemplateContent>;
}

/**
 * Abstract base class with common template processing functionality
 */
export abstract class BaseTemplateProcessor implements ITemplateProcessor {
  abstract process(options: TemplateProcessorOptions): Promise<EmailTemplateContent>;

  /**
   * Render a template with Handlebars semantics, matching SystemEmailService:
   * in an HTML body `{{value}}` is HTML-escaped and `{{{value}}}` inserts
   * prepared HTML (survey rating buttons). Subjects and plain text are not
   * HTML, so they render unescaped. Values are often typed by someone other
   * than the recipient - an MSP naming a customer workspace, for instance -
   * and must never become markup in the email.
   */
  protected replaceTemplateVariables(
    content: string,
    data: Record<string, any>,
    options: { html: boolean }
  ): string {
    return Handlebars.compile(content, { noEscape: !options.html })(data);
  }

  /**
   * Convert HTML to plain text
   */
  protected htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }
}

/**
 * Template processor that loads templates from the database
 * with tenant-specific and system fallback logic, including i18n support
 */
export class DatabaseTemplateProcessor extends BaseTemplateProcessor {
  constructor(
    private knex: Knex | Knex.Transaction,
    private templateName: string
  ) {
    super();
  }

  private tenantTemplatesQuery(tenantId: string) {
    return tenantDb(this.knex, tenantId).table('tenant_email_templates');
  }

  private systemTemplatesQuery(tenantId?: string) {
    return tenantDb(this.knex, tenantId ?? SYSTEM_EMAIL_TEMPLATE_LOOKUP_TENANT)
      .table('system_email_templates');
  }

  async process(options: TemplateProcessorOptions): Promise<EmailTemplateContent> {
    const { tenantId, templateData, locale = 'en' } = options;

    // Try to get tenant-specific template first
    let template: any = null;

    if (tenantId) {
      logger.debug(`[DatabaseTemplateProcessor] Looking for tenant template '${this.templateName}' with locale '${locale}' for tenant '${tenantId}'`);
      template = await this.tenantTemplatesQuery(tenantId)
        .where({ name: this.templateName, language_code: locale })
        .first();

      logger.debug(`[DatabaseTemplateProcessor] Tenant template found:`, template ? {
        name: template.name,
        language_code: template.language_code,
        subject: template.subject
      } : 'null');

      // If requested language not found, fall back to English for tenant templates
      if (!template && locale !== 'en') {
        logger.debug(`[DatabaseTemplateProcessor] Tenant template not found for locale '${locale}', trying English`);
        template = await this.tenantTemplatesQuery(tenantId)
          .where({ name: this.templateName, language_code: 'en' })
          .first();

        logger.debug(`[DatabaseTemplateProcessor] English tenant template:`, template ? {
          name: template.name,
          language_code: template.language_code,
          subject: template.subject
        } : 'null');
      }
    }

    // Fall back to system template if no tenant template
    if (!template) {
      logger.debug(`[DatabaseTemplateProcessor] Looking for template '${this.templateName}' with locale '${locale}'`);

      // Try to get template in requested language
      template = await this.systemTemplatesQuery(tenantId)
        .where({ name: this.templateName, language_code: locale })
        .first();

      logger.debug(`[DatabaseTemplateProcessor] Template found:`, template ? {
        name: template.name,
        language_code: template.language_code,
        subject: template.subject
      } : 'null');

      // If requested language not found, fall back to English
      if (!template && locale !== 'en') {
        logger.warn(`[DatabaseTemplateProcessor] Template '${this.templateName}' not found for locale '${locale}', falling back to English`);
        template = await this.systemTemplatesQuery(tenantId)
          .where({ name: this.templateName, language_code: 'en' })
          .first();

        logger.debug(`[DatabaseTemplateProcessor] English fallback template:`, template ? {
          name: template.name,
          language_code: template.language_code,
          subject: template.subject
        } : 'null');
      }
    }

    if (!template) {
      throw new Error(`Template '${this.templateName}' not found`);
    }

    let subject = template.subject;
    let html = template.html_content;
    let text = template.text_content || this.htmlToText(html);

    // Replace template variables if data provided
    if (templateData) {
      subject = this.replaceTemplateVariables(subject, templateData, { html: false });
      html = this.replaceTemplateVariables(html, templateData, { html: true });
      text = this.replaceTemplateVariables(text, templateData, { html: false });
    }

    return { subject, html, text };
  }
}

/**
 * Template processor that uses static template strings
 */
export class StaticTemplateProcessor extends BaseTemplateProcessor {
  constructor(
    private subject: string,
    private html: string,
    private text?: string
  ) {
    super();
  }

  async process(options: TemplateProcessorOptions): Promise<EmailTemplateContent> {
    const { templateData } = options;

    let processedSubject = this.subject;
    let processedHtml = this.html;
    let processedText = this.text || this.htmlToText(this.html);

    // Replace template variables if data provided
    if (templateData) {
      processedSubject = this.replaceTemplateVariables(processedSubject, templateData, { html: false });
      processedHtml = this.replaceTemplateVariables(processedHtml, templateData, { html: true });
      processedText = this.replaceTemplateVariables(processedText, templateData, { html: false });
    }

    return {
      subject: processedSubject,
      html: processedHtml,
      text: processedText
    };
  }
}

/**
 * Template processor that loads templates from files
 * (Could be implemented later if needed)
 */
export class FileTemplateProcessor extends BaseTemplateProcessor {
  constructor(
    private templatePath: string,
    private fileReader?: (path: string) => Promise<string>
  ) {
    super();
  }

  async process(options: TemplateProcessorOptions): Promise<EmailTemplateContent> {
    // This is a placeholder implementation
    // In a real implementation, you would read template files
    throw new Error('FileTemplateProcessor not yet implemented');
  }
}

/**
 * Template processor that allows for custom template loading logic
 */
export class CustomTemplateProcessor extends BaseTemplateProcessor {
  constructor(
    private loader: (options: TemplateProcessorOptions) => Promise<{
      subject: string;
      html: string;
      text?: string;
    }>
  ) {
    super();
  }

  async process(options: TemplateProcessorOptions): Promise<EmailTemplateContent> {
    const template = await this.loader(options);
    
    let { subject, html, text = this.htmlToText(html) } = template;
    
    // Replace template variables if data provided
    if (options.templateData) {
      subject = this.replaceTemplateVariables(subject, options.templateData, { html: false });
      html = this.replaceTemplateVariables(html, options.templateData, { html: true });
      text = this.replaceTemplateVariables(text, options.templateData, { html: false });
    }

    return { subject, html, text };
  }
}
