// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const en = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../public/locales/en/msp/service-requests.json'), 'utf8')
);
const lookup = (key: string): string | undefined =>
  key.split('.').reduce<any>((node, part) => node?.[part], en);

const actions = vi.hoisted(() => ({ editorData: vi.fn() }));

const stubModule = (overrides: Record<string, unknown> = {}) =>
  new Proxy(overrides, {
    get: (target, key) => {
      if (key === 'then') return undefined;
      if (key === '__esModule') return true;
      return key in target ? target[key as string] : vi.fn().mockResolvedValue(null);
    },
    has: () => true,
  });

vi.mock('next/navigation', () => ({ useParams: () => ({ definitionId: 'definition-1' }), usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => lookup(key) ?? options?.defaultValue ?? key }),
  useFormatters: () => ({ formatDate: (value: unknown) => String(value) }),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => stubModule({
  getServiceRequestDefinitionEditorDataAction: actions.editorData,
  getServiceRequestTicketRoutingReferenceDataAction: vi.fn().mockResolvedValue({ boards: [], priorities: [], users: [] }),
  listServiceRequestDefinitionSubmissionsAction: vi.fn().mockResolvedValue([]),
  validateServiceRequestDefinitionForPublishAction: vi.fn().mockResolvedValue({ errors: [] }),
}));
vi.mock('./ServiceRequestAudienceEditor', () => ({ ServiceRequestAudienceEditor: () => <div data-testid="audience-editor" /> }));
vi.mock('./AnswerMappingSection', () => ({ AnswerMappingSection: () => null }));
vi.mock('./SubmissionMappingPanel', () => ({ SubmissionMappingPanel: () => null }));
vi.mock('./ServiceRequestIconPicker', () => ({ ServiceRequestIconPicker: () => null, default: () => null }));
vi.mock('@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient', () => ({ default: () => null }));
vi.mock('@alga-psa/user-composition/actions', () => stubModule());
vi.mock('@alga-psa/tickets/components', () => stubModule({ CategoryPicker: () => null }));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => stubModule());
vi.mock('@alga-psa/surveys/actions/survey-actions/surveyDashboardActions', () => stubModule());
vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({ BoardPicker: () => null }));
vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({ PrioritySelect: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TemplateTokenInput', () => ({ TemplateTokenInput: () => null }));

const { default: ServiceRequestDefinitionEditorPage } = await import('./ServiceRequestDefinitionEditorPage');

function editorData(showAdvanced: boolean) {
  return {
    definitionId: 'definition-1',
    lifecycleState: 'draft',
    basics: { name: 'Req', description: null, icon: null, categoryId: null, categoryName: null, sortOrder: 0, availableCategories: [] },
    linkage: { linkedServiceId: null, linkedServiceName: null },
    form: { schema: { fields: [] } },
    execution: {
      executionProvider: 'ticket-only',
      executionConfig: {},
      formBehaviorProvider: showAdvanced ? 'advanced' : 'basic',
      formBehaviorConfig: {},
      visibilityProvider: 'all-authenticated-client-users',
      visibilityConfig: {},
      audience: { mode: 'everyone' },
      removedAudienceReferences: [],
      availableExecutionProviders: [],
      availableFormBehaviorProviders: [],
      availableVisibilityProviders: [],
      showWorkflowExecutionConfigPanel: false,
      showAdvancedFormBehaviorConfigPanel: showAdvanced,
    },
    publish: { publishedVersionNumber: null, publishedAt: null, draftUpdatedAt: new Date().toISOString() },
  };
}

describe('service request editor: who can see this form / show or hide fields', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders the new titles, the audience description, the help, three examples and a collapsed JSON panel', async () => {
    actions.editorData.mockResolvedValue(editorData(true));
    render(<ServiceRequestDefinitionEditorPage />);

    expect(await screen.findByText('Who can see this form')).toBeTruthy();
    expect(screen.getByText(en.editor.execution.visibility.description)).toBeTruthy();
    expect(screen.getByText('Show or hide fields (advanced)')).toBeTruthy();
    expect(screen.queryByText('Visibility Configuration')).toBeNull();
    expect(screen.queryByText('Advanced Form Behavior')).toBeNull();

    expect(document.getElementById('service-request-form-behavior-help')).not.toBeNull();
    for (const id of ['showWhen', 'hideWhen', 'clientScoped']) {
      expect(document.getElementById(`service-request-form-behavior-example-${id}`)).not.toBeNull();
    }
    const help = en.editor.execution.advanced.help;
    expect(help.examples.clientScoped.note).toContain('/msp/clients/');
    expect(help.ruleEarlier).toContain('should');
    expect(help.ruleEarlier).not.toContain('must');
    expect(help.ruleHidden).not.toContain('also hides');
    const details = document.getElementById('service-request-form-behavior-config-advanced') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Edit as JSON');
    // The help sits outside the collapsed <details>, so it is readable before opening the editor.
    expect(details.contains(document.getElementById('service-request-form-behavior-help'))).toBe(false);
  });

  it('does not render the help (or the panel) when the advanced panel is gated off', async () => {
    actions.editorData.mockResolvedValue(editorData(false));
    render(<ServiceRequestDefinitionEditorPage />);

    expect(await screen.findByText('Who can see this form')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('audience-editor')).toBeTruthy());
    expect(screen.queryByText('Show or hide fields (advanced)')).toBeNull();
    expect(document.getElementById('service-request-form-behavior-help')).toBeNull();
    expect(document.getElementById('service-request-form-behavior-config-advanced')).toBeNull();
  });
});
