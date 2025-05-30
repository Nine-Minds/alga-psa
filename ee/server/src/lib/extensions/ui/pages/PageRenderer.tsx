/**
 * Custom Page Renderer Component
 * 
 * Renders a custom page extension
 */
'use client';

import React from 'react';
import { PageRendererProps } from './PageTypes';
import { ExtensionRenderer } from '../ExtensionRenderer';
import { ReflectionContainer } from '../../../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../../../types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '../../../../types/ui-reflection/types';
import { logger } from '../../../../utils/logger';

/**
 * Custom Page Renderer component
 * 
 * Renders a custom page extension
 */
export function PageRenderer({
  extensionId,
  component,
  props,
  params = {},
  searchParams = {}
}: PageRendererProps) {
  const { id, title } = props;
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-page-${id}`,
    type: 'container',
    label: title,
    variant: 'default'
  });
  
  return (
    <ReflectionContainer id={`extension-page-${id}`} label={title}>
      <div 
        className="extension-page"
        {...automationIdProps}
      >
        <ExtensionRenderer
          extensionId={extensionId}
          componentPath={component}
          slotProps={{ params, searchParams }}
          defaultProps={props}
          onRender={(time) => {
            logger.debug('Custom page rendered', {
              extensionId,
              component,
              pageId: id,
              renderTime: time
            });
          }}
          onError={(error) => {
            logger.error('Custom page render error', {
              extensionId,
              component,
              pageId: id,
              error
            });
          }}
        />
      </div>
    </ReflectionContainer>
  );
}