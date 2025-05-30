/**
 * Tab Extension Renderer Component
 * 
 * Renders a specific tab extension's content
 */
'use client';

import React from 'react';
import { TabExtensionRendererProps } from './TabExtensionTypes';
import { ExtensionRenderer } from '../ExtensionRenderer';
import { logger } from '../../../../utils/logger';

/**
 * Tab Extension Renderer component
 * 
 * Renders a specific tab extension's content
 */
export function TabExtensionRenderer({
  extensionId,
  component,
  props,
  isActive
}: TabExtensionRendererProps) {
  // Only render the content if the tab is active
  if (!isActive) {
    return null;
  }
  
  return (
    <div className="py-4">
      <ExtensionRenderer
        extensionId={extensionId}
        componentPath={component}
        slotProps={{ isActive }}
        defaultProps={props}
        onRender={(time) => {
          logger.debug('Tab extension rendered', {
            extensionId,
            component,
            tabId: props.id,
            parentPage: props.parentPage,
            renderTime: time
          });
        }}
        onError={(error) => {
          logger.error('Tab extension render error', {
            extensionId,
            component,
            tabId: props.id,
            parentPage: props.parentPage,
            error
          });
        }}
      />
    </div>
  );
}