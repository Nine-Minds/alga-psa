import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectStatusUpdateActions.ts'), 'utf8');

describe('project status update tenant-scoped query contract', () => {
  it('reads every table through the tenant-scoped builder', () => {
    expect(source).toContain("const scopedDb = tenantDb(knex, tenant);");
    expect(source).toContain("scopedDb.table('projects as p')");
    expect(source).toContain("scopedDb.table('project_tasks as t')");
    expect(source).toContain("scopedDb.table('time_entries as te')");
    expect(source).toContain("scopedDb.table('project_phases')");
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain('db.table(table)');

    expect(source).not.toContain("knex('projects')");
    expect(source).not.toContain("knex('contacts')");
    expect(source).not.toContain("knex('system_email_templates')");
    expect(source).not.toContain("knex('tenant_email_templates')");
  });

  it('joins the client, contact and default location through tenantJoin', () => {
    expect(source).toContain("scopedDb.tenantJoin(query, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' })");
    expect(source).toContain("scopedDb.tenantJoin(query, 'contacts as ct', 'p.contact_name_id', 'ct.contact_name_id', { type: 'left' })");
    expect(source).toContain("scopedDb.tenantJoin(query, 'client_locations as dcl', 'p.client_id', 'dcl.client_id'");
  });

  it('signs the update with the shared tenant company resolver', () => {
    // The shared resolver falls back to the tenant's own name, so a tenant with
    // no default client row still signs as itself instead of "Your Company".
    expect(source).toContain('resolveTenantCompanyName');
    expect(source).not.toContain("scopedDb.table('tenant_companies as tc')");
  });

  it('gates read and send on distinct project permissions', () => {
    expect(source).toContain("hasPermission(user, 'project', 'read', knex)");
    expect(source).toContain("hasPermission(user, 'project', 'update', knex)");
  });

  it('never publishes budget hours the portal config hides', () => {
    // The client-portal config is the single switch for what the customer may
    // see; the email must not become a side door around it.
    expect(source).toContain('hours: config.show_budget_hours');
    expect(source).toContain("{ visible: false, used: '', percent: '' }");
    expect(source).toContain('if (config.show_phases) {');
    expect(source).toContain('if (config.show_tasks) {');
  });

  it('falls back tenant → system template and refuses to send without one', () => {
    expect(source).toContain("['tenant_email_templates', locale]");
    expect(source).toContain("['tenant_email_templates', 'en']");
    expect(source).toContain("['system_email_templates', locale]");
    expect(source).toContain("['system_email_templates', 'en']");
    expect(source).toContain("'projects:errors.statusUpdate.templateMissing'");
  });

  it('renders subject and text without HTML escaping', () => {
    expect(source).toContain("Handlebars.compile(template.subject, { noEscape: true })(context)");
    expect(source).toContain("Handlebars.compile(template.text_content, { noEscape: true })(context)");
    expect(source).toContain('Handlebars.compile(template.html_content)(context)');
  });

  it('returns typed action errors instead of throwing at the boundary', () => {
    expect(source).toContain("'projects:errors.statusUpdate.noRecipient'");
    expect(source).toContain("'projects:errors.statusUpdate.emailNotConfigured'");
    expect(source).toContain("'projects:errors.statusUpdate.sendFailed'");
    expect(source).toContain("permissionError('Permission denied: Cannot read project', 'projects:errors.permissions.readProject')");
  });

  it('only drops the tenant slug for an active vanity portal domain', () => {
    expect(source).toContain("portalDomain.status === 'active'");
    expect(source).toContain('?tenant=${buildTenantPortalSlug(tenant)}');
  });
});
