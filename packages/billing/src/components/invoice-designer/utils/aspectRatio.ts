export const ASPECT_RATIO_LOCKABLE_TYPES = new Set<string>(['image', 'logo', 'qr', 'signature']);

export const supportsAspectRatioLock = (nodeType: string) => ASPECT_RATIO_LOCKABLE_TYPES.has(nodeType);
