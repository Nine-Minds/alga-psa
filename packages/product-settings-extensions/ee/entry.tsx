// EE implementation for Settings Extensions feature
// Actual EE component exports

export { default as ExtensionSettings } from '../../../ee/server/src/components/settings/extensions/ExtensionSettings';
export { default as ExtensionDetailsModal } from '../../../ee/server/src/components/settings/extensions/ExtensionDetailsModal';
export { ExtensionPermissions } from '../../../ee/server/src/components/settings/extensions/ExtensionPermissions';
export { default as Extensions } from '../../../ee/server/src/components/settings/extensions/Extensions';
export { default as InstallerPanel } from '../../../ee/server/src/components/settings/extensions/InstallerPanel';
export { default as ExtensionDetails } from '../../../ee/server/src/components/settings/extensions/ExtensionDetails';

// Extension Component Loader for dynamic loading
export { DynamicExtensionsComponent, DynamicInstallExtensionComponent } from '../../../ee/server/src/lib/extensions/ExtensionComponentLoader';

// For compatibility with InstallExtensionSimple imports - alias to InstallerPanel
export { default as InstallExtensionSimple } from '../../../ee/server/src/components/settings/extensions/InstallerPanel';
