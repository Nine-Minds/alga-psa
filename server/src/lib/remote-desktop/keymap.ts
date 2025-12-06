/**
 * Keyboard Key Mappings for Remote Desktop
 *
 * Maps JavaScript KeyboardEvent.code values to platform-specific virtual key codes.
 * These mappings are used by the browser client to send properly formatted key events
 * to the remote agent.
 */

// Windows Virtual Key Codes
// Reference: https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
export const KEY_MAP_WINDOWS: Record<string, number> = {
  // Function keys
  'F1': 0x70,
  'F2': 0x71,
  'F3': 0x72,
  'F4': 0x73,
  'F5': 0x74,
  'F6': 0x75,
  'F7': 0x76,
  'F8': 0x77,
  'F9': 0x78,
  'F10': 0x79,
  'F11': 0x7A,
  'F12': 0x7B,
  'F13': 0x7C,
  'F14': 0x7D,
  'F15': 0x7E,
  'F16': 0x7F,
  'F17': 0x80,
  'F18': 0x81,
  'F19': 0x82,
  'F20': 0x83,
  'F21': 0x84,
  'F22': 0x85,
  'F23': 0x86,
  'F24': 0x87,

  // Special keys
  'PrintScreen': 0x2C,
  'ScrollLock': 0x91,
  'Pause': 0x13,
  'Insert': 0x2D,
  'Delete': 0x2E,
  'Home': 0x24,
  'End': 0x23,
  'PageUp': 0x21,
  'PageDown': 0x22,

  // Arrow keys
  'ArrowLeft': 0x25,
  'ArrowUp': 0x26,
  'ArrowRight': 0x27,
  'ArrowDown': 0x28,

  // Modifiers (left/right variants)
  'ControlLeft': 0xA2,
  'ControlRight': 0xA3,
  'ShiftLeft': 0xA0,
  'ShiftRight': 0xA1,
  'AltLeft': 0xA4,
  'AltRight': 0xA5,
  'MetaLeft': 0x5B,   // Left Windows key
  'MetaRight': 0x5C,  // Right Windows key

  // Navigation cluster
  'NumLock': 0x90,
  'CapsLock': 0x14,

  // Main keyboard - letters
  'KeyA': 0x41,
  'KeyB': 0x42,
  'KeyC': 0x43,
  'KeyD': 0x44,
  'KeyE': 0x45,
  'KeyF': 0x46,
  'KeyG': 0x47,
  'KeyH': 0x48,
  'KeyI': 0x49,
  'KeyJ': 0x4A,
  'KeyK': 0x4B,
  'KeyL': 0x4C,
  'KeyM': 0x4D,
  'KeyN': 0x4E,
  'KeyO': 0x4F,
  'KeyP': 0x50,
  'KeyQ': 0x51,
  'KeyR': 0x52,
  'KeyS': 0x53,
  'KeyT': 0x54,
  'KeyU': 0x55,
  'KeyV': 0x56,
  'KeyW': 0x57,
  'KeyX': 0x58,
  'KeyY': 0x59,
  'KeyZ': 0x5A,

  // Main keyboard - numbers
  'Digit0': 0x30,
  'Digit1': 0x31,
  'Digit2': 0x32,
  'Digit3': 0x33,
  'Digit4': 0x34,
  'Digit5': 0x35,
  'Digit6': 0x36,
  'Digit7': 0x37,
  'Digit8': 0x38,
  'Digit9': 0x39,

  // Numpad
  'Numpad0': 0x60,
  'Numpad1': 0x61,
  'Numpad2': 0x62,
  'Numpad3': 0x63,
  'Numpad4': 0x64,
  'Numpad5': 0x65,
  'Numpad6': 0x66,
  'Numpad7': 0x67,
  'Numpad8': 0x68,
  'Numpad9': 0x69,
  'NumpadMultiply': 0x6A,
  'NumpadAdd': 0x6B,
  'NumpadSubtract': 0x6D,
  'NumpadDecimal': 0x6E,
  'NumpadDivide': 0x6F,
  'NumpadEnter': 0x0D, // Same as Enter

  // Punctuation and symbols
  'Space': 0x20,
  'Enter': 0x0D,
  'Tab': 0x09,
  'Backspace': 0x08,
  'Escape': 0x1B,
  'Minus': 0xBD,
  'Equal': 0xBB,
  'BracketLeft': 0xDB,
  'BracketRight': 0xDD,
  'Backslash': 0xDC,
  'Semicolon': 0xBA,
  'Quote': 0xDE,
  'Backquote': 0xC0,
  'Comma': 0xBC,
  'Period': 0xBE,
  'Slash': 0xBF,
  'IntlBackslash': 0xE2,

  // Media keys
  'AudioVolumeUp': 0xAF,
  'AudioVolumeDown': 0xAE,
  'AudioVolumeMute': 0xAD,
  'MediaTrackNext': 0xB0,
  'MediaTrackPrevious': 0xB1,
  'MediaStop': 0xB2,
  'MediaPlayPause': 0xB3,

  // Browser keys
  'BrowserBack': 0xA6,
  'BrowserForward': 0xA7,
  'BrowserRefresh': 0xA8,
  'BrowserStop': 0xA9,
  'BrowserSearch': 0xAA,
  'BrowserFavorites': 0xAB,
  'BrowserHome': 0xAC,

  // Application keys
  'ContextMenu': 0x5D,  // Applications/Menu key
};

// macOS Key Codes
// Reference: IOKit/hidsystem/ev_keymap.h and Carbon HIToolbox/Events.h
export const KEY_MAP_MACOS: Record<string, number> = {
  // Function keys
  'F1': 0x7A,
  'F2': 0x78,
  'F3': 0x63,
  'F4': 0x76,
  'F5': 0x60,
  'F6': 0x61,
  'F7': 0x62,
  'F8': 0x64,
  'F9': 0x65,
  'F10': 0x6D,
  'F11': 0x67,
  'F12': 0x6F,
  'F13': 0x69,
  'F14': 0x6B,
  'F15': 0x71,
  'F16': 0x6A,
  'F17': 0x40,
  'F18': 0x4F,
  'F19': 0x50,
  'F20': 0x5A,

  // Arrow keys
  'ArrowLeft': 0x7B,
  'ArrowRight': 0x7C,
  'ArrowDown': 0x7D,
  'ArrowUp': 0x7E,

  // Special keys
  'Home': 0x73,
  'End': 0x77,
  'PageUp': 0x74,
  'PageDown': 0x79,
  'Delete': 0x75,      // Forward Delete
  'Backspace': 0x33,   // Delete key on Mac
  'Insert': 0x72,      // Help key on Mac (often used as Insert)

  // Modifiers
  'ShiftLeft': 0x38,
  'ShiftRight': 0x3C,
  'ControlLeft': 0x3B,
  'ControlRight': 0x3E,
  'AltLeft': 0x3A,     // Option
  'AltRight': 0x3D,    // Option
  'MetaLeft': 0x37,    // Command
  'MetaRight': 0x36,   // Command (right, if present)
  'CapsLock': 0x39,

  // Main keyboard - letters
  'KeyA': 0x00,
  'KeyB': 0x0B,
  'KeyC': 0x08,
  'KeyD': 0x02,
  'KeyE': 0x0E,
  'KeyF': 0x03,
  'KeyG': 0x05,
  'KeyH': 0x04,
  'KeyI': 0x22,
  'KeyJ': 0x26,
  'KeyK': 0x28,
  'KeyL': 0x25,
  'KeyM': 0x2E,
  'KeyN': 0x2D,
  'KeyO': 0x1F,
  'KeyP': 0x23,
  'KeyQ': 0x0C,
  'KeyR': 0x0F,
  'KeyS': 0x01,
  'KeyT': 0x11,
  'KeyU': 0x20,
  'KeyV': 0x09,
  'KeyW': 0x0D,
  'KeyX': 0x07,
  'KeyY': 0x10,
  'KeyZ': 0x06,

  // Main keyboard - numbers
  'Digit1': 0x12,
  'Digit2': 0x13,
  'Digit3': 0x14,
  'Digit4': 0x15,
  'Digit5': 0x17,
  'Digit6': 0x16,
  'Digit7': 0x1A,
  'Digit8': 0x1C,
  'Digit9': 0x19,
  'Digit0': 0x1D,

  // Numpad
  'Numpad0': 0x52,
  'Numpad1': 0x53,
  'Numpad2': 0x54,
  'Numpad3': 0x55,
  'Numpad4': 0x56,
  'Numpad5': 0x57,
  'Numpad6': 0x58,
  'Numpad7': 0x59,
  'Numpad8': 0x5B,
  'Numpad9': 0x5C,
  'NumpadDecimal': 0x41,
  'NumpadMultiply': 0x43,
  'NumpadAdd': 0x45,
  'NumpadSubtract': 0x4E,
  'NumpadDivide': 0x4B,
  'NumpadEnter': 0x4C,
  'NumpadEqual': 0x51,
  'NumLock': 0x47,     // Clear key on Mac numpad

  // Punctuation and symbols
  'Space': 0x31,
  'Enter': 0x24,
  'Tab': 0x30,
  'Escape': 0x35,
  'Minus': 0x1B,
  'Equal': 0x18,
  'BracketLeft': 0x21,
  'BracketRight': 0x1E,
  'Backslash': 0x2A,
  'Semicolon': 0x29,
  'Quote': 0x27,
  'Backquote': 0x32,
  'Comma': 0x2B,
  'Period': 0x2F,
  'Slash': 0x2C,
  'IntlBackslash': 0x0A,
};

/**
 * Get the virtual key code for a given JavaScript key code and platform
 */
export function getVirtualKeyCode(
  code: string,
  platform: 'windows' | 'macos'
): number | undefined {
  const keyMap = platform === 'windows' ? KEY_MAP_WINDOWS : KEY_MAP_MACOS;
  return keyMap[code];
}

/**
 * Check if a key is an extended key on Windows
 * Extended keys require the KEYEVENTF_EXTENDEDKEY flag
 */
export function isWindowsExtendedKey(vkCode: number): boolean {
  // Extended keys include:
  // - Arrow keys (0x25-0x28)
  // - Insert (0x2D), Delete (0x2E)
  // - Home (0x24), End (0x23)
  // - Page Up (0x21), Page Down (0x22)
  // - Windows keys (0x5B, 0x5C)
  // - Right Ctrl (0xA3), Right Alt (0xA5)
  // - Numpad Enter (when using VK_RETURN + extended flag)
  // - Numpad / (when using VK_DIVIDE)
  // - Print Screen (0x2C)
  // - Context Menu (0x5D)
  const extendedKeys = [
    0x21, 0x22, 0x23, 0x24, // Page Up/Down, Home, End
    0x25, 0x26, 0x27, 0x28, // Arrow keys
    0x2C, 0x2D, 0x2E,       // Print Screen, Insert, Delete
    0x5B, 0x5C, 0x5D,       // Windows keys, Context Menu
    0xA3, 0xA5,             // Right Ctrl, Right Alt
    0x6F,                   // Numpad Divide
  ];
  return extendedKeys.includes(vkCode);
}

/**
 * Keys that browsers typically intercept and may need special handling
 */
export const BROWSER_INTERCEPTED_KEYS = [
  'F1',           // Help
  'F5',           // Refresh
  'F7',           // Caret browsing (Firefox)
  'F11',          // Fullscreen
  'F12',          // DevTools
  'Tab',          // Focus navigation
  'Escape',       // Cancel dialogs
  'PrintScreen',  // Screenshot
] as const;

/**
 * Key combinations that browsers typically intercept
 */
export const BROWSER_INTERCEPTED_COMBOS = [
  { ctrl: true, key: 'KeyN' },   // New window
  { ctrl: true, key: 'KeyT' },   // New tab
  { ctrl: true, key: 'KeyW' },   // Close tab
  { ctrl: true, key: 'KeyR' },   // Refresh
  { ctrl: true, key: 'KeyL' },   // Address bar
  { ctrl: true, key: 'KeyD' },   // Bookmark
  { ctrl: true, key: 'KeyH' },   // History
  { ctrl: true, key: 'KeyJ' },   // Downloads
  { ctrl: true, key: 'KeyP' },   // Print
  { ctrl: true, key: 'KeyS' },   // Save
  { ctrl: true, key: 'KeyF' },   // Find
  { ctrl: true, key: 'KeyG' },   // Find next
  { ctrl: true, shift: true, key: 'KeyG' },  // Find previous
  { ctrl: true, key: 'Equal' },  // Zoom in
  { ctrl: true, key: 'Minus' },  // Zoom out
  { ctrl: true, key: 'Digit0' }, // Reset zoom
  { alt: true, key: 'ArrowLeft' },  // Back
  { alt: true, key: 'ArrowRight' }, // Forward
  { ctrl: true, key: 'Tab' },    // Next tab
  { ctrl: true, shift: true, key: 'Tab' }, // Previous tab
] as const;

/**
 * Check if a key event should be prevented from reaching the browser
 */
export function shouldPreventDefault(
  code: string,
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
): boolean {
  // Always prevent F-keys when in remote session
  if (code.startsWith('F') && /^F\d+$/.test(code)) {
    return true;
  }

  // Prevent browser-intercepted single keys
  if (BROWSER_INTERCEPTED_KEYS.includes(code as typeof BROWSER_INTERCEPTED_KEYS[number])) {
    return true;
  }

  // Prevent browser-intercepted combinations
  for (const combo of BROWSER_INTERCEPTED_COMBOS) {
    const ctrlMatch = (combo.ctrl ?? false) === modifiers.ctrl;
    const altMatch = (combo.alt ?? false) === modifiers.alt;
    const shiftMatch = (combo.shift ?? false) === modifiers.shift;
    const keyMatch = combo.key === code;

    if (ctrlMatch && altMatch && shiftMatch && keyMatch) {
      return true;
    }
  }

  // Prevent all Ctrl/Cmd combinations to pass through to remote
  if (modifiers.ctrl || modifiers.meta) {
    return true;
  }

  // Prevent Alt combinations (but allow AltGr for special characters)
  if (modifiers.alt && !modifiers.ctrl) {
    return true;
  }

  return false;
}
