import { Action } from '@alga-psa/workflows/forms/actionHandlerRegistry';
import { ActionButton } from './ActionButton';

interface ActionButtonGroupProps {
  actions: Action[];
  onAction: (actionId: string) => Promise<void>;
  isSubmitting?: boolean;
  className?: string;
}

/**
 * Action Button Group component for workflow forms
 * 
 * This component renders a group of action buttons for a workflow form.
 * It handles the layout and styling of multiple action buttons.
 */
export function ActionButtonGroup({
  actions,
  onAction,
  isSubmitting = false,
  className = '',
}: ActionButtonGroupProps) {
  // Filter out hidden actions
  const visibleActions = actions.filter(action => !action.hidden);
  
  // Sort actions by order property
  const sortedActions = [...visibleActions].sort((a, b) => {
    // Primary actions come first
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    
    // Then sort by order
    return (a.order || 0) - (b.order || 0);
  });
  
  if (sortedActions.length === 0) {
    return null;
  }
  
  return (
    <div className={`flex justify-end space-x-2 mt-4 ${className}`}>
      {sortedActions.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          onClick={onAction}
          disabled={isSubmitting}
        />
      ))}
    </div>
  );
}
