/**
 * UI Extension System
 * 
 * Exports all components needed for UI extensions
 */

export * from './types';
export * from './ExtensionProvider';
export * from './ExtensionSlot';
export * from './ExtensionRenderer';
export * from './ExtensionErrorBoundary';

// Export specific extension point components
export * from './tabs';
export * from './navigation';
export * from './pages';