'use client';

import React from 'react';
import { LayoutGrid, AlignLeft } from 'lucide-react';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TicketDetailLayout } from '../../../actions/ticketLayoutPreference';

interface LayoutToggleProps {
  value: TicketDetailLayout;
  onChange: (value: TicketDetailLayout) => void;
  disabled?: boolean;
}

/**
 * Grid | Entry view switcher. Grid is the bento layout; Entry is the classic
 * form layout. Uses the shared ViewSwitcher so it matches every other view-mode
 * toggle in the app. The choice is a per-user preference persisted via
 * ticketLayoutPreference actions (wired by the parent).
 */
export function LayoutToggle({ value, onChange, disabled }: LayoutToggleProps) {
  const { t } = useTranslation('features/tickets');
  return (
    <ViewSwitcher<TicketDetailLayout>
      currentView={value}
      onChange={onChange}
      aria-label={t('bento.layout.ticketLayout', 'Ticket layout')}
      options={[
        { value: 'grid', label: t('bento.layout.grid', 'Grid'), icon: LayoutGrid, id: 'ticket-layout-toggle-grid', disabled },
        { value: 'entry', label: t('bento.layout.entry', 'Entry'), icon: AlignLeft, id: 'ticket-layout-toggle-entry', disabled },
      ]}
    />
  );
}

export default LayoutToggle;
