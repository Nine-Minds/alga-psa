/**
 * Remote Desktop Permission Model
 *
 * Defines and enforces permission checks for remote desktop operations.
 */

/**
 * Permission capabilities for remote desktop access
 */
export interface RemoteAccessPermission {
  /** Can establish a connection to the agent */
  canConnect: boolean;
  /** Can view the remote screen */
  canViewScreen: boolean;
  /** Can control mouse and keyboard */
  canControlInput: boolean;
  /** Can access terminal/shell */
  canAccessTerminal: boolean;
  /** Can transfer files */
  canTransferFiles: boolean;
  /** Can elevate privileges (run as admin) */
  canElevate: boolean;
  /** Requires user consent on remote machine */
  requiresUserConsent: boolean;
  /** Maximum session duration in minutes (optional) */
  sessionDurationLimit?: number;
}

/**
 * Default permission set - minimum viable permissions
 */
export const DEFAULT_PERMISSIONS: RemoteAccessPermission = {
  canConnect: true,
  canViewScreen: true,
  canControlInput: false,
  canAccessTerminal: false,
  canTransferFiles: false,
  canElevate: false,
  requiresUserConsent: true,
};

/**
 * Preset permission configurations for common roles
 */
export const PERMISSION_PRESETS: Record<string, RemoteAccessPermission> = {
  /** View-only access - for monitoring or customer demonstrations */
  viewer: {
    canConnect: true,
    canViewScreen: true,
    canControlInput: false,
    canAccessTerminal: false,
    canTransferFiles: false,
    canElevate: false,
    requiresUserConsent: true,
  },

  /** Standard technician access - most common use case */
  technician: {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: false,
    requiresUserConsent: true,
  },

  /** Administrator access - full capabilities */
  admin: {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: true,
    requiresUserConsent: false,
  },

  /** Unattended access - for maintenance windows */
  unattended: {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: false,
    requiresUserConsent: false,
    sessionDurationLimit: 60, // 1 hour max
  },
};

/**
 * Permission capability names for UI and validation
 */
export type PermissionCapability = keyof RemoteAccessPermission;

/**
 * Human-readable labels for permission capabilities
 */
export const PERMISSION_LABELS: Record<PermissionCapability, string> = {
  canConnect: 'Connect to Agent',
  canViewScreen: 'View Remote Screen',
  canControlInput: 'Control Mouse & Keyboard',
  canAccessTerminal: 'Access Terminal/Shell',
  canTransferFiles: 'Transfer Files',
  canElevate: 'Elevate Privileges',
  requiresUserConsent: 'Requires User Consent',
  sessionDurationLimit: 'Session Duration Limit',
};

/**
 * Permission descriptions for tooltips and help text
 */
export const PERMISSION_DESCRIPTIONS: Record<PermissionCapability, string> = {
  canConnect: 'Allows establishing a remote desktop connection to this agent',
  canViewScreen: 'Allows viewing the remote screen in real-time',
  canControlInput: 'Allows controlling mouse and keyboard on the remote machine',
  canAccessTerminal: 'Allows opening a terminal/command prompt on the remote machine',
  canTransferFiles: 'Allows uploading and downloading files to/from the remote machine',
  canElevate: 'Allows running commands with elevated/administrator privileges',
  requiresUserConsent: 'Requires a user on the remote machine to approve the connection',
  sessionDurationLimit: 'Maximum session duration in minutes (0 = unlimited)',
};

/**
 * Check if permissions grant a specific capability
 */
export function hasCapability(
  permissions: RemoteAccessPermission,
  capability: PermissionCapability
): boolean {
  const value = permissions[capability];
  if (typeof value === 'boolean') {
    return value;
  }
  // For sessionDurationLimit, check if it's defined (any limit means the capability exists)
  return value !== undefined;
}

/**
 * Validate a permission object
 */
export function validatePermissions(permissions: Partial<RemoteAccessPermission>): string[] {
  const errors: string[] = [];

  // canViewScreen requires canConnect
  if (permissions.canViewScreen && permissions.canConnect === false) {
    errors.push('canViewScreen requires canConnect');
  }

  // canControlInput requires canViewScreen
  if (permissions.canControlInput && permissions.canViewScreen === false) {
    errors.push('canControlInput requires canViewScreen');
  }

  // canElevate requires canControlInput
  if (permissions.canElevate && permissions.canControlInput === false) {
    errors.push('canElevate requires canControlInput');
  }

  // canAccessTerminal requires canConnect
  if (permissions.canAccessTerminal && permissions.canConnect === false) {
    errors.push('canAccessTerminal requires canConnect');
  }

  // canTransferFiles requires canConnect
  if (permissions.canTransferFiles && permissions.canConnect === false) {
    errors.push('canTransferFiles requires canConnect');
  }

  // Validate sessionDurationLimit if present
  if (permissions.sessionDurationLimit !== undefined) {
    if (permissions.sessionDurationLimit < 0) {
      errors.push('sessionDurationLimit cannot be negative');
    }
    if (permissions.sessionDurationLimit > 480) { // 8 hours max
      errors.push('sessionDurationLimit cannot exceed 480 minutes (8 hours)');
    }
  }

  return errors;
}

/**
 * Merge two permission sets, taking the more restrictive value for each capability
 */
export function mergePermissions(
  a: RemoteAccessPermission,
  b: RemoteAccessPermission
): RemoteAccessPermission {
  return {
    canConnect: a.canConnect && b.canConnect,
    canViewScreen: a.canViewScreen && b.canViewScreen,
    canControlInput: a.canControlInput && b.canControlInput,
    canAccessTerminal: a.canAccessTerminal && b.canAccessTerminal,
    canTransferFiles: a.canTransferFiles && b.canTransferFiles,
    canElevate: a.canElevate && b.canElevate,
    requiresUserConsent: a.requiresUserConsent || b.requiresUserConsent,
    sessionDurationLimit: Math.min(
      a.sessionDurationLimit ?? Infinity,
      b.sessionDurationLimit ?? Infinity
    ) || undefined,
  };
}

/**
 * Create a permission set from a preset name
 */
export function getPreset(presetName: string): RemoteAccessPermission {
  return PERMISSION_PRESETS[presetName] ?? DEFAULT_PERMISSIONS;
}

/**
 * Check if a permission set allows all the requested capabilities
 */
export function checkCapabilities(
  permissions: RemoteAccessPermission,
  requestedCapabilities: PermissionCapability[]
): { allowed: boolean; deniedCapabilities: PermissionCapability[] } {
  const deniedCapabilities: PermissionCapability[] = [];

  for (const capability of requestedCapabilities) {
    if (!hasCapability(permissions, capability)) {
      deniedCapabilities.push(capability);
    }
  }

  return {
    allowed: deniedCapabilities.length === 0,
    deniedCapabilities,
  };
}

/**
 * Create a sanitized permission object with only valid boolean fields
 */
export function sanitizePermissions(
  input: Partial<RemoteAccessPermission>
): RemoteAccessPermission {
  return {
    canConnect: Boolean(input.canConnect ?? DEFAULT_PERMISSIONS.canConnect),
    canViewScreen: Boolean(input.canViewScreen ?? DEFAULT_PERMISSIONS.canViewScreen),
    canControlInput: Boolean(input.canControlInput ?? DEFAULT_PERMISSIONS.canControlInput),
    canAccessTerminal: Boolean(input.canAccessTerminal ?? DEFAULT_PERMISSIONS.canAccessTerminal),
    canTransferFiles: Boolean(input.canTransferFiles ?? DEFAULT_PERMISSIONS.canTransferFiles),
    canElevate: Boolean(input.canElevate ?? DEFAULT_PERMISSIONS.canElevate),
    requiresUserConsent: Boolean(input.requiresUserConsent ?? DEFAULT_PERMISSIONS.requiresUserConsent),
    sessionDurationLimit: input.sessionDurationLimit,
  };
}
