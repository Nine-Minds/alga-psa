/**
 * The starting points an empty form offers. These are ordinary form schemas shipped as data:
 * choosing one fills the canvas and everything stays editable, exactly as if the author had
 * dragged every element themselves.
 *
 * Labels and help text come in already localized from the caller, so the gallery reads in the
 * author's language without the templates knowing about i18n.
 */
import type { TFunction } from 'i18next';
import type { BasicFormField } from '../../../../lib/service-requests/formSchema';
import type { FormBuilderDocument } from './formBuilderState';

export type FormBuilderTemplateId =
  | 'new-employee-onboarding'
  | 'access-request'
  | 'hardware-repair'
  | 'blank';

export interface FormBuilderTemplate {
  id: FormBuilderTemplateId;
  name: string;
  description: string;
  /** Lucide icon name. */
  icon: string;
  build: () => FormBuilderDocument;
}

function option(label: string, value: string) {
  return { label, value };
}

export function buildFormBuilderTemplates(t: TFunction): FormBuilderTemplate[] {
  const tt = (key: string, defaultValue: string, options?: Record<string, unknown>) =>
    t(`formBuilder.templates.${key}`, { defaultValue, ...(options ?? {}) }) as string;

  const newEmployee = (): BasicFormField[] => [
    {
      key: 'lead_time',
      type: 'callout',
      label: tt('newEmployee.callout.label', 'Give us five working days'),
      helpText: tt(
        'newEmployee.callout.help',
        'Accounts and hardware take a few days to arrange, so tell us as early as you can.'
      ),
      display: { tone: 'info' },
    },
    {
      key: 'employee',
      type: 'section',
      label: tt('newEmployee.section.employee', 'Employee'),
      helpText: tt('newEmployee.section.employeeHelp', "Who's joining and when they start."),
    },
    {
      key: 'full_name',
      type: 'short-text',
      label: tt('newEmployee.fullName', 'Full name'),
      required: true,
      layout: { width: 'half' },
    },
    {
      key: 'start_date',
      type: 'date',
      label: tt('newEmployee.startDate', 'Start date'),
      required: true,
      layout: { width: 'half' },
    },
    {
      key: 'department',
      type: 'select',
      label: tt('newEmployee.department', 'Department'),
      required: true,
      options: [
        option(tt('newEmployee.departments.engineering', 'Engineering'), 'engineering'),
        option(tt('newEmployee.departments.sales', 'Sales'), 'sales'),
        option(tt('newEmployee.departments.operations', 'Operations'), 'operations'),
        option(tt('newEmployee.departments.finance', 'Finance'), 'finance'),
        option(tt('newEmployee.departments.customerSuccess', 'Customer Success'), 'customer_success'),
      ],
    },
    {
      key: 'needs_laptop',
      type: 'checkbox',
      label: tt('newEmployee.needsLaptop', 'Needs a laptop?'),
      helpText: tt('newEmployee.needsLaptopHelp', "We'll set it up before the start date."),
    },
    {
      key: 'hardware',
      type: 'section',
      label: tt('newEmployee.section.hardware', 'Hardware'),
      // The section and everything it owns appear only once the laptop box is ticked.
      visibleWhen: [{ source: 'needs_laptop', operator: 'is-true' }],
    },
    {
      key: 'laptop_model',
      type: 'radio',
      label: tt('newEmployee.laptopModel', 'Laptop model'),
      options: [
        option(tt('newEmployee.laptops.macbookAir', 'MacBook Air 13"'), 'macbook_air_13'),
        option(tt('newEmployee.laptops.latitude', 'Dell Latitude 5450'), 'dell_latitude_5450'),
        option(tt('newEmployee.laptops.thinkpad', 'Lenovo ThinkPad T14'), 'lenovo_thinkpad_t14'),
      ],
    },
    {
      key: 'peripherals',
      type: 'multi-select',
      label: tt('newEmployee.peripherals', 'Peripherals'),
      options: [
        option(tt('newEmployee.peripheralOptions.monitor', 'External monitor'), 'monitor'),
        option(tt('newEmployee.peripheralOptions.dock', 'Dock'), 'dock'),
        option(tt('newEmployee.peripheralOptions.headset', 'Headset'), 'headset'),
        option(tt('newEmployee.peripheralOptions.keyboard', 'Keyboard and mouse'), 'keyboard_mouse'),
      ],
    },
    {
      key: 'signed_equipment_policy',
      type: 'file-upload',
      label: tt('newEmployee.policy', 'Signed equipment policy (PDF)'),
    },
  ];

  const accessRequest = (): BasicFormField[] => [
    {
      key: 'approval',
      type: 'callout',
      label: tt('access.callout.label', 'Your manager will be asked to approve'),
      helpText: tt('access.callout.help', 'Access changes need a sign-off before we action them.'),
      display: { tone: 'warning' },
    },
    { key: 'request', type: 'section', label: tt('access.section', 'What access is needed') },
    {
      key: 'requested_for',
      type: 'short-text',
      label: tt('access.requestedFor', 'Requested for'),
      required: true,
      layout: { width: 'half' },
    },
    {
      key: 'system',
      type: 'short-text',
      label: tt('access.system', 'Application or system'),
      required: true,
      layout: { width: 'half' },
    },
    {
      key: 'request_type',
      type: 'radio',
      label: tt('access.requestType', 'Request type'),
      required: true,
      options: [
        option(tt('access.requestTypes.new', 'New access'), 'new'),
        option(tt('access.requestTypes.change', 'Change existing access'), 'change'),
        option(tt('access.requestTypes.remove', 'Remove access'), 'remove'),
      ],
    },
    {
      key: 'needed_by',
      type: 'date',
      label: tt('access.neededBy', 'Needed by'),
      layout: { width: 'half' },
    },
    {
      key: 'justification',
      type: 'long-text',
      label: tt('access.justification', 'Business justification'),
      required: true,
      validation: { minLength: 20 },
    },
  ];

  const hardwareRepair = (): BasicFormField[] => [
    { key: 'device', type: 'section', label: tt('repair.section.device', 'The device') },
    {
      key: 'asset_tag',
      type: 'short-text',
      label: tt('repair.assetTag', 'Asset tag or serial number'),
      required: true,
      layout: { width: 'half' },
    },
    {
      key: 'device_type',
      type: 'select',
      label: tt('repair.deviceType', 'Device type'),
      required: true,
      layout: { width: 'half' },
      options: [
        option(tt('repair.deviceTypes.laptop', 'Laptop'), 'laptop'),
        option(tt('repair.deviceTypes.desktop', 'Desktop'), 'desktop'),
        option(tt('repair.deviceTypes.monitor', 'Monitor'), 'monitor'),
        option(tt('repair.deviceTypes.phone', 'Phone'), 'phone'),
        option(tt('repair.deviceTypes.other', 'Other'), 'other'),
      ],
    },
    { key: 'problem', type: 'section', label: tt('repair.section.problem', "What's wrong") },
    {
      key: 'symptoms',
      type: 'long-text',
      label: tt('repair.symptoms', 'Describe the problem'),
      required: true,
      validation: { minLength: 20 },
    },
    {
      key: 'still_usable',
      type: 'checkbox',
      label: tt('repair.stillUsable', 'The device still works well enough to use'),
    },
    { key: 'photo', type: 'file-upload', label: tt('repair.photo', 'Photo of the problem') },
  ];

  return [
    {
      id: 'new-employee-onboarding',
      name: tt('newEmployee.name', 'New employee onboarding'),
      description: tt('newEmployee.description', 'Who is joining, when, and what they need on day one.'),
      icon: 'UserPlus',
      build: () => ({ elements: newEmployee(), settings: {} }),
    },
    {
      id: 'access-request',
      name: tt('access.name', 'Access request'),
      description: tt('access.description', 'New, changed or removed access to a system.'),
      icon: 'KeyRound',
      build: () => ({ elements: accessRequest(), settings: {} }),
    },
    {
      id: 'hardware-repair',
      name: tt('repair.name', 'Hardware repair'),
      description: tt('repair.description', 'A device that needs fixing or replacing.'),
      icon: 'Wrench',
      build: () => ({ elements: hardwareRepair(), settings: {} }),
    },
    {
      id: 'blank',
      name: tt('blank.name', 'Start blank'),
      description: tt('blank.description', 'An empty form you build one question at a time.'),
      icon: 'FilePlus2',
      build: () => ({ elements: [], settings: {} }),
    },
  ];
}
