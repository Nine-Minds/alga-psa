import React from 'react';
import { UIStateProvider } from '@alga-psa/ui/ui-reflection/UIStateContext';

interface TestWrapperProps {
  children: React.ReactNode;
}

export function TestWrapper({ children }: TestWrapperProps) {
  return (
    <UIStateProvider>
      {children}
    </UIStateProvider>
  );
}

// Custom render function that includes providers
import { render, RenderOptions } from '@testing-library/react';

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: TestWrapper, ...options });
}