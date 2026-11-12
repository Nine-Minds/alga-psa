/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import CustomSelect from '../CustomSelect';

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

beforeAll(() => {
  // Radix Select relies on layout APIs jsdom does not implement.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const options = Array.from({ length: 30 }, (_, index) => ({
  value: `option-${index}`,
  label: `Option ${index}`,
}));

const openSelect = async () => {
  const trigger = screen.getByRole('combobox');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return waitFor(() => screen.getByTestId('custom-select-viewport'));
};

describe('CustomSelect', () => {
  it('keeps the option list in place when the viewport scrolls', async () => {
    render(
      <CustomSelect id="long-select" options={options} value="option-0" onValueChange={() => {}} />
    );

    const viewport = await openSelect();
    const content = viewport.parentElement as HTMLElement;
    const renderedChildren = () => Array.from(content.children).filter((child) => child.tagName !== 'STYLE');
    const contentChildrenBefore = renderedChildren();

    // Scrolling must not mount anything into the content's flow above or below
    // the options (Radix scroll buttons did, shifting options under a pressed
    // pointer so the release landed on a different option).
    await act(async () => {
      viewport.scrollTop = 120;
      fireEvent.scroll(viewport);
    });

    expect(renderedChildren()).toEqual(contentChildrenBefore);
    expect(contentChildrenBefore).toEqual([viewport]);
  });

  it('commits the option chosen from the list', async () => {
    const onValueChange = vi.fn();
    render(
      <CustomSelect id="commit-select" options={options} value="option-0" onValueChange={onValueChange} />
    );

    await openSelect();
    const option = screen.getByRole('option', { name: 'Option 7' });
    fireEvent.keyDown(option, { key: 'Enter' });

    expect(onValueChange).toHaveBeenCalledWith('option-7');
  });

  it('keeps a value that arrives after mount inside a form', async () => {
    // Radix mirrors the value into a hidden <select> for form submission and
    // echoes that select's change event back through onValueChange. Before the
    // option list has registered, the echo carries '' — which used to wipe the
    // record an edit form had just loaded.
    const onValueChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = React.useState('');
      React.useEffect(() => {
        setValue('option-5');
      }, []);
      return (
        <form>
          <CustomSelect
            id="prefilled-select"
            options={options}
            value={value}
            required
            onValueChange={(next) => {
              onValueChange(next);
              setValue(next);
            }}
          />
        </form>
      );
    };

    render(<Harness />);

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Option 5'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('cancels the just-closed marker timer when unmounted right after closing', async () => {
    const { unmount } = render(
      <CustomSelect id="unmount-select" options={options} value="option-0" onValueChange={() => {}} />
    );

    await openSelect();
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(screen.getByRole('option', { name: 'Option 3' }), { key: 'Enter' });
      expect(document.body.getAttribute('data-radix-select-just-closed')).toBe('true');

      unmount();
      expect(document.body.hasAttribute('data-radix-select-just-closed')).toBe(false);

      // A timer outliving the component would touch `document` after teardown;
      // prove none is left by checking it no longer clears a marker set later.
      document.body.setAttribute('data-radix-select-just-closed', 'true');
      vi.runAllTimers();
      expect(document.body.getAttribute('data-radix-select-just-closed')).toBe('true');
      document.body.removeAttribute('data-radix-select-just-closed');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('customStyles class merging', () => {
    const getContent = async () => {
      const viewport = await openSelect();
      return viewport.parentElement as HTMLElement;
    };

    it('lets customStyles.content replace the conflicting base max-w', async () => {
      render(
        <CustomSelect
          id="merge-select"
          options={options}
          value="option-0"
          onValueChange={() => {}}
          customStyles={{ content: 'max-w-[var(--radix-select-trigger-width)]' }}
        />
      );
      const content = await getContent();
      expect(content.className).toContain('max-w-[var(--radix-select-trigger-width)]');
      expect(content.className.split(/\s+/)).not.toContain('max-w-full');
      // Non-conflicting base classes survive the merge.
      expect(content.className).toContain('min-w-[var(--radix-select-trigger-width)]');
      expect(content.className).toContain('z-[10001]');
    });

    it('keeps the base content classes when no customStyles are passed', async () => {
      render(<CustomSelect id="base-select" options={options} value="option-0" onValueChange={() => {}} />);
      const classes = (await getContent()).className.split(/\s+/);
      expect(classes).toContain('max-w-full');
      expect(classes).toContain('min-w-[var(--radix-select-trigger-width)]');
      expect(classes).toContain('mt-1');
      expect(classes).toContain('z-[10001]');
      expect(classes).toContain('[&[data-side=top]]:mb-2');
      expect(classes).toContain('[&[data-side=bottom]]:mt-2');
    });

    it('lets customStyles.item override conflicting base item classes', async () => {
      render(
        <CustomSelect
          id="item-select"
          options={options}
          value="option-0"
          onValueChange={() => {}}
          customStyles={{ item: 'whitespace-normal' }}
        />
      );
      await openSelect();
      const classes = screen.getByRole('option', { name: 'Option 3' }).className.split(/\s+/);
      expect(classes).toContain('whitespace-normal');
      expect(classes).not.toContain('whitespace-nowrap');
    });
  });
});
