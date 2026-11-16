// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ServiceRequestFormBuilder } from './ServiceRequestFormBuilder';

const actions = vi.hoisted(() => ({
  replaceSchema: vi.fn().mockResolvedValue({}),
  validateForPublish: vi.fn().mockResolvedValue({ errors: [] }),
  publish: vi.fn().mockResolvedValue({}),
  updateFormBehaviorConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('../actions', () => ({
  replaceServiceRequestFormSchemaAction: actions.replaceSchema,
  validateServiceRequestDefinitionForPublishAction: actions.validateForPublish,
  publishServiceRequestDefinitionAction: actions.publish,
  updateServiceRequestFormBehaviorConfigAction: actions.updateFormBehaviorConfig,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Translations come from the real en locale pack, so the assertions exercise the copy an
// author actually reads rather than pinning source strings in the test.
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const en = (
    await import('../../../../../public/locales/en/msp/service-requests.json')
  ).default as Record<string, unknown>;

  const resolve = (key: string): string | undefined => {
    let node: unknown = en;
    for (const part of key.split('.')) {
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : undefined;
  };

  return {
    detectClientLocale: () => 'en',
    useOptionalI18n: () => null,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
        const template = resolve(key) ?? options?.defaultValue ?? key;
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
          options && options[name] !== undefined ? String(options[name]) : match
        );
      },
    }),
  };
});

const schema = {
  fields: [
    { key: 'employee', type: 'section', label: 'Employee' },
    { key: 'full_name', type: 'short-text', label: 'Full name', required: true },
    { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop?' },
    { key: 'laptop_model', type: 'short-text', label: 'Laptop model' },
  ],
};

/** The onboarding shape the design brief asks for: a checkbox that reveals a whole section. */
const conditionalSectionSchema = {
  fields: [
    { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop?' },
    {
      key: 'hardware',
      type: 'section',
      label: 'Hardware',
      visibleWhen: [{ source: 'needs_laptop', operator: 'is-true' }],
    },
    { key: 'laptop_model', type: 'short-text', label: 'Laptop model' },
  ],
};

function renderBuilder(overrides: Partial<React.ComponentProps<typeof ServiceRequestFormBuilder>> = {}) {
  return render(
    <ServiceRequestFormBuilder
      definitionId="definition-1"
      definitionName="New employee setup"
      initialSchema={schema}
      backHref="/msp/service-requests/definition-1"
      {...overrides}
    />
  );
}

const canvasElement = (key: string) =>
  document.getElementById(`service-request-form-canvas-element-${key}`)!;

/** Where the builder keeps its browser-local copy of an unsaved draft. */
const BACKUP_KEY = 'alga.serviceRequestFormBuilder.draftBackup.definition-1';
/** Long enough for the backup (500 ms) and the save (900 ms) debounces to have fired. */
const SAVE_SETTLE_MS = 1300;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The builder remembers the author's left tab and sidebar width in localStorage, so a test
  // that switched tabs would otherwise decide which pane the next test opens on.
  window.localStorage.clear();
});

describe('Form Studio selection and inspector', () => {
  it('selects an element on the canvas and shows its settings in the inspector', async () => {
    const user = userEvent.setup();
    renderBuilder();

    expect(screen.getByText('Select an element on the form to change it.')).toBeInTheDocument();

    await user.click(canvasElement('full_name'));

    const label = document.getElementById('service-request-form-builder-label') as HTMLInputElement;
    expect(label).toHaveValue('Full name');
    expect(document.getElementById('service-request-form-builder-required')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(document.getElementById('service-request-form-builder-key')).toHaveValue('full_name');
  });

  it('refuses a key another question already uses, and says so', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    const key = document.getElementById('service-request-form-builder-key') as HTMLInputElement;
    await user.clear(key);
    await user.type(key, 'needs_laptop');
    await user.tab();

    expect(
      screen.getByText(
        'Another question already uses the answer key "needs_laptop". The previous key is still in use.'
      )
    ).toBeInTheDocument();
    // The box goes back to the key actually in force rather than keeping the refused one.
    expect(key).toHaveValue('full_name');
    expect(canvasElement('full_name')).toBeInTheDocument();
  });

  it('refuses a blank key instead of renaming the question to "field"', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    const key = document.getElementById('service-request-form-builder-key') as HTMLInputElement;
    await user.clear(key);
    await user.tab();

    expect(
      screen.getByText('An answer key cannot be blank. The previous key is still in use.')
    ).toBeInTheDocument();
    expect(key).toHaveValue('full_name');
    expect(canvasElement('full_name')).toBeInTheDocument();
  });

  it('round-trips an inspector edit back onto the canvas', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    const label = document.getElementById('service-request-form-builder-label')!;
    await user.clear(label);
    await user.type(label, 'Employee name');

    expect(
      screen.getByText('Employee name', {
        selector: '#service-request-form-canvas-label-full_name',
      })
    ).toBeInTheDocument();
  });

  it('keeps the outline in sync with what is selected on the canvas', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(screen.getByRole('tab', { name: 'Outline' }));
    const row = document.getElementById('service-request-form-outline-row-needs_laptop')!;
    await user.click(row);

    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(document.getElementById('service-request-form-builder-label')).toHaveValue(
      'Needs a laptop?'
    );
  });
});

describe('Form Studio inline rename', () => {
  it('renames from the canvas label, commits on Enter, and mirrors into the inspector', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-canvas-label-full_name')!);

    const input = document.getElementById('service-request-form-canvas-label-full_name-rename')!;
    await user.clear(input);
    await user.type(input, 'Employee name{Enter}');

    expect(
      document.getElementById('service-request-form-canvas-label-full_name-rename')
    ).toBeNull();
    expect(document.getElementById('service-request-form-builder-label')).toHaveValue(
      'Employee name'
    );
  });

  it('commits the rename when the author leaves the field', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-canvas-label-full_name')!);
    const input = document.getElementById('service-request-form-canvas-label-full_name-rename')!;
    await user.clear(input);
    await user.type(input, 'Employee name');
    await user.click(canvasElement('needs_laptop'));

    expect(
      screen.getByText('Employee name', {
        selector: '#service-request-form-canvas-label-full_name',
      })
    ).toBeInTheDocument();
  });

  it('throws the rename away on Escape', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-canvas-label-full_name')!);
    const input = document.getElementById('service-request-form-canvas-label-full_name-rename')!;
    await user.clear(input);
    await user.type(input, 'Nope{Escape}');

    expect(document.getElementById('service-request-form-builder-label')).toHaveValue('Full name');
  });

  it('is one undo step, however many keys were pressed', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-canvas-label-full_name')!);
    const input = document.getElementById('service-request-form-canvas-label-full_name-rename')!;
    await user.clear(input);
    await user.type(input, 'Employee name{Enter}');

    await user.click(document.getElementById('service-request-form-builder-undo')!);
    expect(document.getElementById('service-request-form-builder-label')).toHaveValue('Full name');
    expect(document.getElementById('service-request-form-builder-undo')).toBeDisabled();
  });
});

describe('Form Studio adding and saving', () => {
  it('adds the clicked palette element after the selection and saves the whole schema once', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-builder-add-email')!);

    await waitFor(() => expect(actions.replaceSchema).toHaveBeenCalled(), { timeout: 3000 });
    expect(document.getElementById('service-request-form-builder-key')).toHaveValue('email_address');
    const [definitionId, fields] = actions.replaceSchema.mock.calls.at(-1)!;
    expect(definitionId).toBe('definition-1');
    expect((fields as Array<{ key: string }>).map((field) => field.key)).toEqual([
      'employee',
      'full_name',
      'email_address',
      'needs_laptop',
      'laptop_model',
    ]);
  });
});

describe('Form Studio opening a definition', () => {
  it('adopts a legacy rule onto its element without counting that as an edit', async () => {
    const user = userEvent.setup();
    renderBuilder({
      initialFormBehaviorConfig: {
        visibilityRules: [
          { fieldKey: 'laptop_model', source: 'needs_laptop', operator: 'is-true' },
        ],
      },
    });

    // The rule reads as the element's own condition, editable like any other…
    await user.click(canvasElement('laptop_model'));
    expect(document.getElementById('service-request-form-builder-visibility-0-source')).toHaveTextContent(
      'Needs a laptop?'
    );

    // …but merely opening the definition is not an edit: nothing is saved or backed up, and
    // the author is not warned about leaving.
    await new Promise((resolve) => setTimeout(resolve, SAVE_SETTLE_MS));
    expect(actions.replaceSchema).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it('keeps a browser-local backup of an edit that the save has not landed yet', async () => {
    const user = userEvent.setup();
    // A save that never answers stands in for the tab dying mid-flight; the backup is what the
    // next visit offers back.
    actions.replaceSchema.mockImplementationOnce(() => new Promise(() => {}));
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-builder-add-email')!);

    await waitFor(() => expect(window.localStorage.getItem(BACKUP_KEY)).not.toBeNull(), {
      timeout: 3000,
    });
    const backup = JSON.parse(window.localStorage.getItem(BACKUP_KEY)!);
    expect(
      (backup.definition.elements as Array<{ key: string }>).map((element) => element.key)
    ).toContain('email_address');
  });
});

describe('Form Studio Try it', () => {
  it('runs the form live and reveals a field when its rule is satisfied', async () => {
    const user = userEvent.setup();
    renderBuilder({
      initialFormBehaviorConfig: {
        visibilityRules: [
          { fieldKey: 'laptop_model', source: 'needs_laptop', operator: 'is-true' },
        ],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Try it' }));
    expect(document.getElementById('service-request-form-try-field-laptop_model')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Needs a laptop?' }));
    expect(document.getElementById('service-request-form-try-field-laptop_model')).not.toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Needs a laptop?' }));
    expect(document.getElementById('service-request-form-try-field-laptop_model')).toBeNull();
  });

  it('reveals a whole section, and the questions in it, from the element rule', async () => {
    const user = userEvent.setup();
    renderBuilder({ initialSchema: conditionalSectionSchema });

    await user.click(screen.getByRole('button', { name: 'Try it' }));
    expect(screen.queryByRole('heading', { name: 'Hardware' })).toBeNull();
    expect(document.getElementById('service-request-form-try-field-laptop_model')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Needs a laptop?' }));
    expect(screen.getByRole('heading', { name: 'Hardware' })).toBeInTheDocument();
    expect(document.getElementById('service-request-form-try-field-laptop_model')).not.toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Needs a laptop?' }));
    expect(screen.queryByRole('heading', { name: 'Hardware' })).toBeNull();
    expect(document.getElementById('service-request-form-try-field-laptop_model')).toBeNull();
  });

  it('reports a missing required answer without submitting anything', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(screen.getByRole('button', { name: 'Try it' }));
    await user.click(screen.getByRole('button', { name: 'Check the answers' }));

    expect(screen.getByRole('alert')).toHaveTextContent('This question needs an answer.');
    expect(actions.replaceSchema).not.toHaveBeenCalled();
  });
});

describe('Form Studio template gallery', () => {
  it('opens an empty form on the gallery and fills the canvas from a template', async () => {
    const user = userEvent.setup();
    renderBuilder({ initialSchema: { fields: [] } });

    expect(screen.getByText('Start from a template')).toBeInTheDocument();

    await user.click(document.getElementById('service-request-form-template-access-request')!);

    expect(screen.queryByText('Start from a template')).toBeNull();
    expect(canvasElement('requested_for')).toBeInTheDocument();
  });

  it('puts the gallery away for a blank start, and costs no undo step doing it', async () => {
    const user = userEvent.setup();
    renderBuilder({ initialSchema: { fields: [] } });

    await user.click(document.getElementById('service-request-form-template-blank')!);

    expect(screen.queryByText('Start from a template')).toBeNull();
    expect(document.getElementById('service-request-form-canvas')).not.toBeNull();
    // Nothing was added, so there is nothing to take back.
    expect(document.getElementById('service-request-form-builder-undo')).toBeDisabled();

    // And the way back, for an author who would rather start from a template after all.
    await user.click(document.getElementById('service-request-form-canvas-show-templates')!);
    expect(screen.getByText('Start from a template')).toBeInTheDocument();
  });
});

describe('Form Studio defaults', () => {
  it('takes back a typed default answer in one undo step', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    const defaultInput = document.getElementById('service-request-form-builder-default')!;
    await user.type(defaultInput, 'Ada');
    expect(defaultInput).toHaveValue('Ada');

    await user.click(document.getElementById('service-request-form-builder-undo')!);
    expect(document.getElementById('service-request-form-builder-default')).toHaveValue('');
    expect(document.getElementById('service-request-form-builder-undo')).toBeDisabled();
  });
});

describe('Form Studio conditions', () => {
  it('offers the condition editor on a section and saves the rule onto the element', async () => {
    const user = userEvent.setup();
    renderBuilder({ initialSchema: conditionalSectionSchema });

    await user.click(canvasElement('hardware'));
    expect(screen.getByText('Only show this when…')).toBeInTheDocument();

    // The sentence reads "When <the laptop question> is <ticked>".
    const inspector = document.getElementById('service-request-form-builder-inspector-body')!;
    expect(within(inspector).getByText('Needs a laptop?')).toBeInTheDocument();
    expect(within(inspector).getByText('ticked')).toBeInTheDocument();

    await waitFor(() => expect(actions.replaceSchema).not.toHaveBeenCalled());
    await user.click(document.getElementById('service-request-form-builder-visibility-0-remove')!);
    await waitFor(() => expect(actions.replaceSchema).toHaveBeenCalled(), { timeout: 3000 });

    const [, fields] = actions.replaceSchema.mock.calls.at(-1)!;
    const hardware = (fields as Array<{ key: string; visibleWhen?: unknown }>).find(
      (field) => field.key === 'hardware'
    );
    expect(hardware?.visibleWhen).toBeUndefined();
  });

  it('adds a condition from the inspector on an element that has none', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('laptop_model'));
    expect(screen.getByText('Without a rule it is always shown.')).toBeInTheDocument();

    await user.click(document.getElementById('service-request-form-builder-visibility-add')!);
    await waitFor(() => expect(actions.replaceSchema).toHaveBeenCalled(), { timeout: 3000 });

    const [, fields] = actions.replaceSchema.mock.calls.at(-1)!;
    const laptop = (fields as Array<{ key: string; visibleWhen?: unknown }>).find(
      (field) => field.key === 'laptop_model'
    );
    expect(laptop?.visibleWhen).toEqual([{ source: 'full_name', operator: 'equals', value: '' }]);
  });
});

describe('Form Studio publish', () => {
  it('writes the pending draft before publishing it', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(canvasElement('full_name'));
    await user.click(document.getElementById('service-request-form-builder-add-email')!);
    await user.click(document.getElementById('service-request-form-builder-publish')!);

    await waitFor(() => expect(actions.publish).toHaveBeenCalledWith('definition-1'));
    expect(actions.replaceSchema).toHaveBeenCalled();
    expect(actions.validateForPublish).toHaveBeenCalledWith('definition-1');
  });

  it('does not publish while the definition still fails validation', async () => {
    actions.validateForPublish.mockResolvedValueOnce({ errors: ['Pick a category first'] });
    const user = userEvent.setup();
    renderBuilder();

    await user.click(document.getElementById('service-request-form-builder-publish')!);

    await waitFor(() => expect(actions.validateForPublish).toHaveBeenCalled());
    expect(actions.publish).not.toHaveBeenCalled();
  });

  // A toast pinned to the top right of the window covers Edit / Try it and Publish at
  // 1280 px and eats their clicks, so the builder answers in its own banner instead.
  it('answers in a banner under the toolbar, not over the toolbar', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(document.getElementById('service-request-form-builder-publish')!);

    const notice = await waitFor(() => {
      const element = document.getElementById('service-request-form-builder-notice');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(notice).toHaveTextContent('Published.');
    // The banner sits inside the builder, above the panes — never over the toolbar.
    expect(document.getElementById('service-request-form-builder')).toContainElement(notice);
    expect(
      document.getElementById('service-request-form-builder-toolbar')
    ).not.toContainElement(notice);

    await user.click(document.getElementById('service-request-form-builder-notice-dismiss')!);
    expect(document.getElementById('service-request-form-builder-notice')).toBeNull();
  });

  it('keeps a blocked publish on screen with the reason', async () => {
    actions.validateForPublish.mockResolvedValueOnce({ errors: ['Pick a category first'] });
    const user = userEvent.setup();
    renderBuilder();

    await user.click(document.getElementById('service-request-form-builder-publish')!);

    // The sentence the author reads is localized; the validator's own wording, which this
    // screen does not own, is shown under it as detail rather than standing in for it.
    await waitFor(() =>
      expect(document.getElementById('service-request-form-builder-notice')).toHaveTextContent(
        'Fix what the definition page reports, then publish.'
      )
    );
    expect(
      document.getElementById('service-request-form-builder-notice-detail')
    ).toHaveTextContent('Pick a category first');
  });
});
