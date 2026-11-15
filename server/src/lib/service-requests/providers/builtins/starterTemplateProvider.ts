import type {
  ServiceRequestTemplateDefinition,
  ServiceRequestTemplateDraft,
  ServiceRequestTemplateProvider,
} from '../contracts';
import type { BasicFormField } from '../../basicFormBuilder';

function buildCeStarterProviders(executionConfig: Record<string, unknown>) {
  return {
    executionProvider: 'ticket-only',
    executionConfig,
    formBehaviorProvider: 'basic',
    formBehaviorConfig: {},
    visibilityProvider: 'all-authenticated-client-users',
    visibilityConfig: {},
  };
}

function buildTemplateDraft(
  metadata: ServiceRequestTemplateDraft['metadata'],
  fields: BasicFormField[],
  executionConfig: Record<string, unknown>
): ServiceRequestTemplateDraft {
  return {
    metadata,
    formSchema: {
      fields,
    },
    providers: buildCeStarterProviders(executionConfig),
  };
}

const starterTemplates: ServiceRequestTemplateDefinition[] = [
  {
    id: 'new-hire',
    name: 'New Hire Onboarding',
    description: 'Request setup for a new employee joining your organization.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'New Hire Onboarding',
          description: 'Request setup for a new employee joining your organization.',
          icon: 'user-plus',
        },
        [
          {
            key: 'lead_time_notice',
            type: 'callout',
            label: 'Give us five working days',
            helpText:
              'Accounts and hardware take a few days to arrange. Tell us as early as you can so everything is ready on day one.',
            display: { tone: 'info' },
          },
          { key: 'employee_section', type: 'section', label: 'Employee', helpText: 'Who is joining and when.' },
          {
            key: 'employee_name',
            type: 'short-text',
            label: 'Employee Name',
            required: true,
            layout: { width: 'half' },
          },
          {
            key: 'start_date',
            type: 'date',
            label: 'Start Date',
            required: true,
            layout: { width: 'half' },
          },
          { key: 'job_title', type: 'short-text', label: 'Job Title', required: false, layout: { width: 'half' } },
          {
            key: 'department',
            type: 'select',
            label: 'Department',
            required: false,
            layout: { width: 'half' },
            options: [
              { label: 'Engineering', value: 'Engineering' },
              { label: 'Sales', value: 'Sales' },
              { label: 'Operations', value: 'Operations' },
              { label: 'Finance', value: 'Finance' },
              { label: 'Customer Success', value: 'Customer Success' },
            ],
          },
          { key: 'manager_name', type: 'short-text', label: 'Manager Name', required: false, layout: { width: 'half' } },
          {
            key: 'work_email',
            type: 'email',
            label: 'Personal Email for the Welcome Note',
            required: false,
            layout: { width: 'half' },
            placeholder: 'name@example.com',
          },
          {
            key: 'work_location',
            type: 'radio',
            label: 'Work Location',
            required: true,
            options: [
              { label: 'Office', value: 'Office' },
              { label: 'Remote', value: 'Remote' },
              { label: 'Hybrid', value: 'Hybrid' },
            ],
          },
          {
            key: 'employment_type',
            type: 'select',
            label: 'Employment Type',
            required: false,
            options: [
              { label: 'Full-time', value: 'Full-time' },
              { label: 'Part-time', value: 'Part-time' },
              { label: 'Contractor', value: 'Contractor' },
              { label: 'Temporary', value: 'Temporary' },
            ],
          },
          { key: 'equipment_section', type: 'section', label: 'Equipment and access' },
          {
            key: 'needs_laptop',
            type: 'checkbox',
            label: 'Needs a laptop?',
            helpText: 'We will set it up and ship it to the work location.',
            required: false,
          },
          {
            key: 'peripherals',
            type: 'multi-select',
            label: 'Peripherals',
            required: false,
            options: [
              { label: 'External monitor', value: 'External monitor' },
              { label: 'Dock', value: 'Dock' },
              { label: 'Headset', value: 'Headset' },
              { label: 'Keyboard and mouse', value: 'Keyboard and mouse' },
            ],
          },
          {
            key: 'software_access_needed',
            type: 'long-text',
            label: 'Software / Access Needed',
            required: false,
            validation: { maxLength: 2000 },
          },
          {
            key: 'signed_equipment_policy',
            type: 'file-upload',
            label: 'Signed Equipment Policy (PDF)',
            required: false,
          },
        ],
        {
          titleTemplate: 'New Hire Onboarding: {{employee_name}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
  {
    id: 'employee-offboarding',
    name: 'Employee Offboarding',
    description: 'Request account shutdown and return handling for a departing employee.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'Employee Offboarding',
          description: 'Request account shutdown and return handling for a departing employee.',
          icon: 'user-minus',
        },
        [
          { key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true },
          { key: 'last_working_date', type: 'date', label: 'Last Working Date', required: true },
          { key: 'department', type: 'short-text', label: 'Department', required: false },
          { key: 'manager_name', type: 'short-text', label: 'Manager Name', required: false },
          {
            key: 'disable_access_immediately',
            type: 'checkbox',
            label: 'Disable Access Immediately',
            required: false,
          },
          {
            key: 'recover_company_equipment',
            type: 'checkbox',
            label: 'Recover Company Equipment',
            required: false,
          },
          {
            key: 'mailbox_forwarding_contact',
            type: 'short-text',
            label: 'Mailbox Forwarding Contact',
            required: false,
          },
          {
            key: 'offboarding_notes',
            type: 'long-text',
            label: 'Additional Notes',
            required: false,
          },
        ],
        {
          titleTemplate: 'Employee Offboarding: {{employee_name}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
  {
    id: 'access-request',
    name: 'Access Request',
    description: 'Request new, changed, or removed access to a system or application.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'Access Request',
          description: 'Request new, changed, or removed access to a system or application.',
          icon: 'key-round',
        },
        [
          {
            key: 'approval_notice',
            type: 'callout',
            label: 'Your manager will be asked to approve',
            helpText: 'Access changes need a manager sign-off before we can action them.',
            display: { tone: 'warning' },
          },
          { key: 'request_section', type: 'section', label: 'What access is needed' },
          {
            key: 'requested_for',
            type: 'short-text',
            label: 'Requested For',
            required: true,
            layout: { width: 'half' },
          },
          {
            key: 'application_or_system',
            type: 'short-text',
            label: 'Application or System',
            required: true,
            layout: { width: 'half' },
          },
          {
            key: 'request_type',
            type: 'select',
            label: 'Request Type',
            required: true,
            options: [
              { label: 'New access', value: 'New access' },
              { label: 'Change existing access', value: 'Change existing access' },
              { label: 'Remove access', value: 'Remove access' },
            ],
          },
          {
            key: 'access_level_needed',
            type: 'short-text',
            label: 'Access Level Needed',
            required: false,
          },
          { key: 'needed_by_date', type: 'date', label: 'Needed By Date', required: false },
          {
            key: 'business_justification',
            type: 'long-text',
            label: 'Business Justification',
            required: true,
          },
          { key: 'manager_name', type: 'short-text', label: 'Manager Name', required: false },
          {
            key: 'supporting_attachment',
            type: 'file-upload',
            label: 'Supporting Attachment',
            required: false,
          },
        ],
        {
          titleTemplate: 'Access Request: {{requested_for}} - {{application_or_system}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
  {
    id: 'hardware-request',
    name: 'Hardware Request',
    description: 'Request new equipment, replacement hardware, or accessories.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'Hardware Request',
          description: 'Request new equipment, replacement hardware, or accessories.',
          icon: 'laptop',
        },
        [
          { key: 'requested_for', type: 'short-text', label: 'Requested For', required: true },
          {
            key: 'hardware_type',
            type: 'select',
            label: 'Hardware Type',
            required: true,
            options: [
              { label: 'Laptop', value: 'Laptop' },
              { label: 'Desktop', value: 'Desktop' },
              { label: 'Monitor', value: 'Monitor' },
              { label: 'Dock', value: 'Dock' },
              { label: 'Phone', value: 'Phone' },
              { label: 'Accessory', value: 'Accessory' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            key: 'quantity',
            type: 'number',
            label: 'Quantity',
            required: true,
            defaultValue: '1',
            layout: { width: 'half' },
            validation: { min: 1, max: 50, message: 'Ask for between 1 and 50 items on one request.' },
          },
          {
            key: 'request_reason',
            type: 'select',
            label: 'Request Reason',
            required: false,
            options: [
              { label: 'New equipment', value: 'New equipment' },
              { label: 'Replacement', value: 'Replacement' },
              { label: 'Upgrade', value: 'Upgrade' },
              { label: 'Loaner', value: 'Loaner' },
              { label: 'Other', value: 'Other' },
            ],
          },
          { key: 'needed_by_date', type: 'date', label: 'Needed By Date', required: false },
          {
            key: 'delivery_location',
            type: 'short-text',
            label: 'Delivery Location',
            required: false,
          },
          {
            key: 'business_justification',
            type: 'long-text',
            label: 'Business Justification',
            required: true,
          },
          {
            key: 'additional_details',
            type: 'long-text',
            label: 'Additional Details',
            required: false,
          },
        ],
        {
          titleTemplate: 'Hardware Request: {{requested_for}} - {{hardware_type}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
  {
    id: 'software-license-request',
    name: 'Software / License Request',
    description: 'Request software installation, license provisioning, or additional seats.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'Software / License Request',
          description: 'Request software installation, license provisioning, or additional seats.',
          icon: 'app-window',
        },
        [
          { key: 'requested_for', type: 'short-text', label: 'Requested For', required: true },
          { key: 'software_name', type: 'short-text', label: 'Software Name', required: true },
          {
            key: 'platform',
            type: 'select',
            label: 'Platform',
            required: false,
            options: [
              { label: 'Windows', value: 'Windows' },
              { label: 'macOS', value: 'macOS' },
              { label: 'Web', value: 'Web' },
              { label: 'Mobile', value: 'Mobile' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            key: 'license_type_or_edition',
            type: 'short-text',
            label: 'License Type or Edition',
            required: false,
          },
          { key: 'needed_by_date', type: 'date', label: 'Needed By Date', required: false },
          {
            key: 'business_justification',
            type: 'long-text',
            label: 'Business Justification',
            required: true,
          },
          { key: 'manager_name', type: 'short-text', label: 'Manager Name', required: false },
          {
            key: 'vendor_quote_or_screenshot',
            type: 'file-upload',
            label: 'Vendor Quote or Screenshot',
            required: false,
          },
          {
            key: 'additional_details',
            type: 'long-text',
            label: 'Additional Details',
            required: false,
          },
        ],
        {
          titleTemplate: 'Software / License Request: {{requested_for}} - {{software_name}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
  {
    id: 'shared-mailbox-distribution-list',
    name: 'Shared Mailbox / Distribution List Request',
    description: 'Request a shared mailbox, distribution list, or Microsoft 365 group.',
    buildDraft: () =>
      buildTemplateDraft(
        {
          name: 'Shared Mailbox / Distribution List Request',
          description: 'Request a shared mailbox, distribution list, or Microsoft 365 group.',
          icon: 'mail',
        },
        [
          {
            key: 'request_type',
            type: 'select',
            label: 'Request Type',
            required: true,
            options: [
              { label: 'Shared mailbox', value: 'Shared mailbox' },
              { label: 'Distribution list', value: 'Distribution list' },
              { label: 'Microsoft 365 group', value: 'Microsoft 365 group' },
            ],
          },
          {
            key: 'mailbox_or_group_name',
            type: 'short-text',
            label: 'Mailbox or Group Name',
            required: true,
          },
          { key: 'primary_owner', type: 'short-text', label: 'Primary Owner', required: true },
          {
            key: 'additional_members',
            type: 'long-text',
            label: 'Additional Members',
            required: false,
          },
          {
            key: 'allow_external_senders',
            type: 'checkbox',
            label: 'Allow External Senders',
            required: false,
          },
          {
            key: 'department_or_team',
            type: 'short-text',
            label: 'Department or Team',
            required: false,
          },
          { key: 'needed_by_date', type: 'date', label: 'Needed By Date', required: false },
          {
            key: 'business_purpose',
            type: 'long-text',
            label: 'Business Purpose',
            required: true,
          },
          {
            key: 'additional_notes',
            type: 'long-text',
            label: 'Additional Notes',
            required: false,
          },
        ],
        {
          titleTemplate: 'Mailbox / Group Request: {{mailbox_or_group_name}}',
          includeFormResponsesInDescription: true,
        }
      ),
  },
];

export const starterTemplateProvider: ServiceRequestTemplateProvider = {
  key: 'ce-starter-pack',
  displayName: 'CE Starter Pack',
  listTemplates: () => starterTemplates,
};
