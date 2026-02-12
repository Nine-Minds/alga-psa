import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('deletion migrations', () => {
  it('T067: deleteClient uses deleteEntityWithValidation', () => {
    const content = read('packages/clients/src/actions/clientActions.ts');
    expect(content).toContain("deleteEntityWithValidation('client'");
  });

  it('T068: deleteClient returns IS_DEFAULT error for default company', () => {
    const content = read('packages/clients/src/actions/clientActions.ts');
    expect(content).toContain('IS_DEFAULT');
  });

  it('T069: deleteClient no longer manually calls deleteEntityTags', () => {
    const content = read('packages/clients/src/actions/clientActions.ts');
    expect(content).not.toContain('deleteEntityTags');
  });

  it('T070: ClientDetails uses DeleteEntityDialog for deletion', () => {
    const content = read('packages/clients/src/components/clients/ClientDetails.tsx');
    expect(content).toContain('<DeleteEntityDialog');
  });

  it('T071: ClientDetails calls validateClientDeletion on dialog open', () => {
    const content = read('packages/clients/src/components/clients/ClientDetails.tsx');
    expect(content).toContain('validateClientDeletion');
  });

  it('T072: ClientDetails wires deactivate alternative to markClientInactiveWithContacts', () => {
    const content = read('packages/clients/src/components/clients/ClientDetails.tsx');
    expect(content).toContain('markClientInactiveWithContacts');
  });

  it('T073: ClientDetails no longer renders inline dependency JSX', () => {
    const content = read('packages/clients/src/components/clients/ClientDetails.tsx');
    expect(content.toLowerCase()).not.toContain('dependency');
  });

  it('T074: Contact deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/clients/src/actions/contact-actions/contactActions.tsx');
    const ui = read('packages/clients/src/components/contacts/ContactDetails.tsx');
    expect(action).toContain("deleteEntityWithValidation('contact'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T075: Contact deletion no longer manually calls deleteEntityTags', () => {
    const action = read('packages/clients/src/actions/contact-actions/contactActions.tsx');
    expect(action).not.toContain('deleteEntityTags');
  });

  it('T076: User deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/users/src/actions/user-actions/userActions.ts');
    const ui = read('packages/client-portal/src/components/settings/UserManagementSettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('user'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T077: Team deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/teams/src/actions/team-actions/teamActions.ts');
    const ui = read('server/src/components/settings/general/TeamList.tsx');
    expect(action).toContain("deleteEntityWithValidation('team'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T078: Contract line deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/billing/src/actions/contractLineAction.ts');
    const ui = read('packages/billing/src/components/billing-dashboard/ContractLines.tsx');
    expect(action).toContain("deleteEntityWithValidation('contract_line'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T079: Service deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/billing/src/actions/serviceActions.ts');
    const ui = read('packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx');
    expect(action).toContain("deleteEntityWithValidation('service'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T080: Tax rate deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/billing/src/actions/taxRateActions.ts');
    const ui = read('packages/billing/src/components/billing-dashboard/TaxRates.tsx');
    expect(action).toContain("deleteEntityWithValidation('tax_rate'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T081: Invoice template deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/billing/src/actions/invoiceTemplates.ts');
    const ui = read('packages/billing/src/components/billing-dashboard/InvoiceTemplates.tsx');
    expect(action).toContain("deleteEntityWithValidation('invoice_template'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T082: Ticket deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/tickets/src/actions/ticketActions.ts');
    const ui = read('packages/tickets/src/components/TicketingDashboard.tsx');
    expect(action).toContain("deleteEntityWithValidation('ticket'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T083: Ticket deletion no longer manually calls deleteEntityTags', () => {
    const action = read('packages/tickets/src/actions/ticketActions.ts');
    expect(action).not.toContain('deleteEntityTags');
  });

  it('T084: Project deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/projects/src/actions/projectActions.ts');
    const ui = read('packages/projects/src/components/Projects.tsx');
    expect(action).toContain("deleteEntityWithValidation('project'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T085: Project deletion cleans up child task tags', () => {
    const action = read('packages/projects/src/actions/projectActions.ts');
    expect(action).toContain('deleteEntitiesTags');
    expect(action).toContain("'project_task'");
  });

  it('T086: Project task deletion no longer manually calls deleteEntityTags', () => {
    const action = read('packages/projects/src/actions/projectTaskActions.ts');
    expect(action).not.toContain('deleteEntityTags');
  });

  it('T087: Category deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/tickets/src/actions/ticketCategoryActions.ts');
    const ui = read('packages/tickets/src/components/settings/CategoriesSettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('category'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T088: Status deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/reference-data/src/actions/status-actions/statusActions.ts');
    const ui = read('packages/projects/src/components/settings/projects/ProjectStatusSettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('status'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T089: Priority deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/reference-data/src/actions/priorityActions.ts');
    const ui = read('packages/reference-data/src/components/settings/PrioritySettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('priority'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T090: Board deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/tickets/src/actions/board-actions/boardActions.ts');
    const ui = read('server/src/components/settings/general/BoardsSettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('board'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T091: Document deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/documents/src/actions/documentActions.ts');
    const ui = read('packages/documents/src/components/DocumentStorageCard.tsx');
    expect(action).toContain("deleteEntityWithValidation('document'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T092: Asset deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/assets/src/actions/assetActions.ts');
    const ui = read('packages/assets/src/components/DeleteAssetButton.tsx');
    expect(action).toContain("deleteEntityWithValidation('asset'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T093: Schedule entry deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/scheduling/src/actions/scheduleActions.ts');
    const ui = read('packages/scheduling/src/components/schedule/ScheduleCalendar.tsx');
    expect(action).toContain("deleteEntityWithValidation('schedule_entry'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T094: Survey template deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/surveys/src/actions/surveyActions.ts');
    const ui = read('packages/surveys/src/components/templates/TemplateList.tsx');
    expect(action).toContain("deleteEntityWithValidation('survey_template'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T095: Workflow deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/workflows/src/actions/workflow-runtime-v2-actions.ts');
    const ui = read('packages/workflows/src/components/automation-hub/WorkflowList.tsx');
    expect(action).toContain("deleteEntityWithValidation('workflow'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T096: Role deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/auth/src/actions/policyActions.ts');
    const ui = read('packages/auth/src/components/settings/policy/RoleManagement.tsx');
    expect(action).toContain("deleteEntityWithValidation('role'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T097: Interaction type deletion uses deleteEntityWithValidation + DeleteEntityDialog', () => {
    const action = read('packages/clients/src/actions/interactionTypeActions.ts');
    const ui = read('server/src/components/settings/general/InteractionTypeSettings.tsx');
    expect(action).toContain("deleteEntityWithValidation('interaction_type'");
    expect(ui).toContain('<DeleteEntityDialog');
  });

  it('T098: ConfirmationDialog component retains non-deletion capabilities', () => {
    const content = read('packages/ui/src/components/ConfirmationDialog.tsx');
    expect(content).toContain('thirdButtonLabel');
    expect(content).toContain('options');
  });

  it('T099: Non-deletion uses of ConfirmationDialog still exist', () => {
    const content = read('packages/clients/src/components/clients/ClientDetails.tsx');
    expect(content).toContain('<ConfirmationDialog');
  });
});
