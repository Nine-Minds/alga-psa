'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { SpecialKeyCombo, SpecialKeyComboEvent } from '@/types/remoteDesktop';

interface SpecialKeysMenuProps {
  /**
   * Callback when a special key combination is triggered
   */
  onSpecialKey: (event: SpecialKeyComboEvent) => void;

  /**
   * Whether the menu is enabled (connection is active)
   */
  enabled: boolean;

  /**
   * Target OS for showing appropriate key combinations
   */
  targetOs?: 'windows' | 'macos';
}

interface SpecialKeyItem {
  combo: SpecialKeyCombo;
  label: string;
  description: string;
  windowsOnly?: boolean;
  macOnly?: boolean;
  icon?: React.ReactNode;
}

const SPECIAL_KEYS: SpecialKeyItem[] = [
  {
    combo: 'ctrl-alt-del',
    label: 'Ctrl+Alt+Del',
    description: 'Open Security Options / Task Manager',
    windowsOnly: true,
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    combo: 'ctrl-shift-esc',
    label: 'Ctrl+Shift+Esc',
    description: 'Open Task Manager directly',
    windowsOnly: true,
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    combo: 'win-l',
    label: 'Win+L',
    description: 'Lock the workstation',
    windowsOnly: true,
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    combo: 'win-r',
    label: 'Win+R',
    description: 'Open Run dialog',
    windowsOnly: true,
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    combo: 'alt-tab',
    label: 'Alt+Tab',
    description: 'Switch between applications',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
      </svg>
    ),
  },
  {
    combo: 'print-screen',
    label: 'Print Screen',
    description: 'Take screenshot on remote machine',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

/**
 * SpecialKeysMenu - UI for sending special key combinations that can't be captured from browser
 *
 * Some key combinations like Ctrl+Alt+Del are intercepted by the OS before
 * they reach the browser. This menu provides buttons to send these combinations
 * directly to the remote agent.
 */
export const SpecialKeysMenu: React.FC<SpecialKeysMenuProps> = ({
  onSpecialKey,
  enabled,
  targetOs = 'windows',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleSendSpecialKey = useCallback((combo: SpecialKeyCombo) => {
    if (!enabled) return;

    const event: SpecialKeyComboEvent = {
      type: 'SpecialKeyCombo',
      combo,
    };

    onSpecialKey(event);

    // Provide visual feedback
    setIsOpen(false);
  }, [enabled, onSpecialKey]);

  // Filter keys based on target OS
  const filteredKeys = SPECIAL_KEYS.filter((key) => {
    if (key.windowsOnly && targetOs !== 'windows') return false;
    if (key.macOnly && targetOs !== 'macos') return false;
    return true;
  });

  return (
    <div className="relative inline-block">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!enabled}
        variant="ghost"
        size="sm"
        className="text-gray-300 hover:text-white hover:bg-gray-800"
      >
        <svg
          className="w-4 h-4 mr-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
        Special Keys
        <svg
          className={`w-4 h-4 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      {isOpen && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-20">
            <div className="p-2">
              <div className="text-xs text-gray-400 px-2 py-1 mb-1">
                Send Special Key Combinations
              </div>

              {filteredKeys.map((key) => (
                <button
                  key={key.combo}
                  onClick={() => handleSendSpecialKey(key.combo)}
                  disabled={!enabled}
                  className="w-full flex items-center px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex-shrink-0 mr-3 text-gray-400">
                    {key.icon}
                  </span>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{key.label}</div>
                    <div className="text-xs text-gray-400">{key.description}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Help text */}
            <div className="border-t border-gray-700 px-4 py-2">
              <p className="text-xs text-gray-500">
                These key combinations cannot be captured by the browser and must be sent via this menu.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Inline button for common special keys (e.g., Ctrl+Alt+Del button in toolbar)
 */
interface SpecialKeyButtonProps {
  combo: SpecialKeyCombo;
  onSend: (event: SpecialKeyComboEvent) => void;
  enabled: boolean;
  className?: string;
}

export const SpecialKeyButton: React.FC<SpecialKeyButtonProps> = ({
  combo,
  onSend,
  enabled,
  className = '',
}) => {
  const keyInfo = SPECIAL_KEYS.find((k) => k.combo === combo);
  if (!keyInfo) return null;

  const handleClick = () => {
    if (!enabled) return;
    onSend({
      type: 'SpecialKeyCombo',
      combo,
    });
  };

  return (
    <Button
      onClick={handleClick}
      disabled={!enabled}
      variant="ghost"
      size="sm"
      className={`text-gray-300 hover:text-white hover:bg-gray-800 ${className}`}
      title={keyInfo.description}
    >
      {keyInfo.icon}
      <span className="ml-2">{keyInfo.label}</span>
    </Button>
  );
};

export default SpecialKeysMenu;
