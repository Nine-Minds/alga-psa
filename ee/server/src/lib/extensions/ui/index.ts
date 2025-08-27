/**
 * UI Extension System
 *
 * Descriptor-based UI, tabs/pages/navigation, and host-side renderer have been removed.
 * Runner iframe is now the only supported rendering mechanism.
 *
 * Public exports are limited to iframe bridge utilities and ExtensionProvider (if still used).
 */

export * from './ExtensionProvider';
export * from './iframeBridge';