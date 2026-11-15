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
}));

vi.mock('../actions', () => ({
  replaceServiceRequestFormSchemaAction: actions.replaceSchema,
  validateServiceRequestDefinitionForPublishAction: actions.validateForPublish,
  publishServiceRequestDefinitionAction: actions.publish,
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
});
