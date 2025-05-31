/**
 * Custom error classes for the extension system
 */

/**
 * Base error class for all extension-related errors
 */
export class ExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtensionError';
  }
}

/**
 * Error thrown when extension validation fails
 */
export class ExtensionValidationError extends ExtensionError {
  errors: Array<{ path: string; message: string }>;

  constructor(message: string, errors: Array<{ path: string; message: string }>) {
    super(message);
    this.name = 'ExtensionValidationError';
    this.errors = errors;
  }
}

/**
 * Error thrown when an extension cannot be found
 */
export class ExtensionNotFoundError extends ExtensionError {
  extensionId: string;

  constructor(extensionId: string) {
    super(`Extension not found: ${extensionId}`);
    this.name = 'ExtensionNotFoundError';
    this.extensionId = extensionId;
  }
}

/**
 * Error thrown when there's an issue loading an extension
 */
export class ExtensionLoadError extends ExtensionError {
  extensionId: string;

  constructor(extensionId: string, message: string) {
    super(`Failed to load extension ${extensionId}: ${message}`);
    this.name = 'ExtensionLoadError';
    this.extensionId = extensionId;
  }
}

/**
 * Error thrown when an extension is disabled
 */
export class ExtensionDisabledError extends ExtensionError {
  extensionId: string;

  constructor(extensionId: string) {
    super(`Extension is disabled: ${extensionId}`);
    this.name = 'ExtensionDisabledError';
    this.extensionId = extensionId;
  }
}

/**
 * Error thrown when there's a version incompatibility
 */
export class ExtensionVersionError extends ExtensionError {
  extensionId: string;
  version: string;
  requiredVersion: string;

  constructor(extensionId: string, version: string, requiredVersion: string) {
    super(
      `Extension ${extensionId} version ${version} is incompatible. Required: ${requiredVersion}`
    );
    this.name = 'ExtensionVersionError';
    this.extensionId = extensionId;
    this.version = version;
    this.requiredVersion = requiredVersion;
  }
}

/**
 * Error thrown when a required extension dependency is missing
 */
export class ExtensionDependencyError extends ExtensionError {
  extensionId: string;
  dependencyId: string;

  constructor(extensionId: string, dependencyId: string) {
    super(
      `Extension ${extensionId} requires extension ${dependencyId}, which is not installed or enabled`
    );
    this.name = 'ExtensionDependencyError';
    this.extensionId = extensionId;
    this.dependencyId = dependencyId;
  }
}

/**
 * Error thrown when an extension doesn't have the required permissions
 */
export class ExtensionPermissionError extends ExtensionError {
  extensionId: string;
  permission: string;

  constructor(extensionId: string, permission: string) {
    super(
      `Extension ${extensionId} does not have the required permission: ${permission}`
    );
    this.name = 'ExtensionPermissionError';
    this.extensionId = extensionId;
    this.permission = permission;
  }
}

/**
 * Error thrown when there's an issue with extension storage
 */
export class ExtensionStorageError extends ExtensionError {
  extensionId: string;

  constructor(extensionId: string, message: string) {
    super(`Storage error for extension ${extensionId}: ${message}`);
    this.name = 'ExtensionStorageError';
    this.extensionId = extensionId;
  }
}

/**
 * Error thrown when storage quota is exceeded
 */
export class ExtensionStorageQuotaError extends ExtensionStorageError {
  quota: number;
  usage: number;

  constructor(extensionId: string, quota: number, usage: number) {
    super(
      extensionId,
      `Storage quota exceeded. Limit: ${quota} bytes, Current usage: ${usage} bytes`
    );
    this.name = 'ExtensionStorageQuotaError';
    this.quota = quota;
    this.usage = usage;
  }
}

/**
 * Error thrown when a component cannot be found
 */
export class ExtensionComponentNotFoundError extends ExtensionError {
  extensionId: string;
  componentPath: string;

  constructor(extensionId: string, componentPath: string) {
    super(
      `Component not found in extension ${extensionId}: ${componentPath}`
    );
    this.name = 'ExtensionComponentNotFoundError';
    this.extensionId = extensionId;
    this.componentPath = componentPath;
  }
}