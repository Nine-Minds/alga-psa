import { Knex } from 'knex';
import logger from '@alga-psa/shared/core/logger';
import { SupportedLocale } from '../../i18n/config';

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
   * Replace template variables with actual data
   */
  protected replaceTemplateVariables(
    content: string, 
    data: Record<string, any>
  ): string {
    let result = content;
    
    // Flatten nested objects for template replacement
    const flattenedData = this.flattenObject(data);
    
    // Replace template variables
    Object.entries(flattenedData).forEach(([key, value]) => {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(placeholder, String(value ?? ''));
    });
    
    return result;
  }

  /**
   * Flatten nested objects for template variable replacement
   */
  private flattenObject(
    obj: Record<string, any>, 
    prefix = ''
  ): Record<string, any> {
    return Object.entries(obj).reduce((acc: Record<string, any>, [key, value]) => {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        Object.assign(acc, this.flattenObject(value, newKey));
      } else {
        acc[newKey] = value;
      }
      return acc;
    }, {});
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

  async process(options: TemplateProcessorOptions): Promise<EmailTemplateContent> {
    const { tenantId, templateData, locale = 'en' } = options;

    // Try to get tenant-specific template first
    let template: any = null;

    if (tenantId) {
      template = await this.knex('tenant_email_templates')
        .where({ tenant: tenantId, name: this.templateName })
        .first();
    }

    // Fall back to system template if no tenant template
    if (!template) {
      // Try to get template in requested language
      template = await this.knex('system_email_templates')
        .where({ name: this.templateName, language_code: locale })
        .first();

      // If requested language not found, fall back to English
      if (!template && locale !== 'en') {
        logger.warn(`[DatabaseTemplateProcessor] Template '${this.templateName}' not found for locale '${locale}', falling back to English`);
        template = await this.knex('system_email_templates')
          .where({ name: this.templateName, language_code: 'en' })
          .first();
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
      subject = this.replaceTemplateVariables(subject, templateData);
      html = this.replaceTemplateVariables(html, templateData);
      text = this.replaceTemplateVariables(text, templateData);
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
      processedSubject = this.replaceTemplateVariables(processedSubject, templateData);
      processedHtml = this.replaceTemplateVariables(processedHtml, templateData);
      processedText = this.replaceTemplateVariables(processedText, templateData);
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
      subject = this.replaceTemplateVariables(subject, options.templateData);
      html = this.replaceTemplateVariables(html, options.templateData);
      text = this.replaceTemplateVariables(text, options.templateData);
    }

    return { subject, html, text };
  }
}
