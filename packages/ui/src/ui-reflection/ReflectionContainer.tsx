'use client';

import React, { PropsWithChildren, useEffect } from 'react';
import { useRegisterUIComponent } from './useRegisterUIComponent';
import { ContainerComponent } from './types';
import { ReflectionParentContext, useReflectionParent } from './ReflectionParentContext';
import { withUIReflectionId } from './withDataAutomationId';

interface ReflectionContainerProps extends PropsWithChildren {
  id: string;
  label?: string;
  className?: string;
  'data-automation-type'?: string;
}

/**
 * A generic container that:
 * 1) Registers itself with the reflection system as a container
 * 2) Automatically provides its ID as the "parent" for any child components
 * 3) Automatically sets data-automation-id for testing
 */
function ReflectionContainerBase({ 
  id, 
  label, 
  className,
  children,
  'data-automation-type': dataAutomationType 
}: ReflectionContainerProps) {
  // Get parent ID from context (if any)
  // Convert null to undefined for type compatibility
  const parentId = useReflectionParent() ?? undefined;

  const updateContainer = useRegisterUIComponent<ContainerComponent>({
    id,
    type: 'container',
    label,
    parentId, // Pass through parent ID from context if available
  });

  // Update container metadata when props change
  useEffect(() => {
    updateContainer({ label });
  }, [label]);

  return (
    <ReflectionParentContext.Provider value={id}>
      <div 
        data-automation-id={id}
        data-automation-type={dataAutomationType}
        className={className}
      >
        {children}
      </div>
    </ReflectionParentContext.Provider>
  );
}

// Wrap with HOC to handle data-automation-id
export const ReflectionContainer = withUIReflectionId(ReflectionContainerBase);
