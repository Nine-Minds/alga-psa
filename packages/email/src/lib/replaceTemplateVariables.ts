/**
 * Minimal Handlebars-ish renderer for the system email templates stored in
 * `system_email_templates`: `{{variable}}` substitution plus
 * `{{#if flag}}…{{else}}…{{/if}}` conditionals.
 *
 * The `{{else}}` arm matters: the tenant-recovery template phrases the
 * single-organization case there, and a renderer that only understood
 * `{{#if}}…{{/if}}` shipped "{{else}}Here is your login link:" to recipients
 * verbatim. Nested conditionals are still not supported — no template uses them.
 */
const IF_BLOCK = /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

export function replaceTemplateVariables(template: string, variables: Record<string, any>): string {
  let result = template;

  result = result.replace(IF_BLOCK, (_match, condition: string, whenTrue: string, whenFalse?: string) =>
    variables[condition] ? whenTrue : (whenFalse ?? '')
  );

  // Replace simple variables {{variableName}}
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, String(value || ''));
  }

  return result;
}
