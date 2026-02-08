import React, { useState, useCallback, useRef, useEffect } from 'react';

export type TabItem = {
  /** Unique key for the tab */
  key: string;
  /** Tab label */
  label: React.ReactNode;
  /** Tab content */
  content: React.ReactNode;
  /** Whether the tab is disabled */
  disabled?: boolean;
};

export type TabsProps = {
  /** Tab items */
  tabs: TabItem[];
  /** Currently active tab key */
  activeKey?: string;
  /** Default active tab key (uncontrolled mode) */
  defaultActiveKey?: string;
  /** Callback when tab changes */
  onChange?: (key: string) => void;
  /** Tab bar style */
  variant?: 'default';
  /** Additional styles for container */
  style?: React.CSSProperties;
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  borderBottom: '1px solid var(--alga-border, #e5e7eb)',
  marginBottom: '16px',
};

const baseTabStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--alga-muted-fg, #6b7280)',
  backgroundColor: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  position: 'relative',
  marginBottom: '-1px',
};

const activeTabStyle: React.CSSProperties = {
  ...baseTabStyle,
  color: 'var(--alga-primary, #9855ee)',
  fontWeight: 500,
  borderBottom: '2px solid var(--alga-primary, #9855ee)',
};

const disabledTabStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

export function Tabs({
  tabs,
  activeKey: controlledActiveKey,
  defaultActiveKey,
  onChange,
  variant = 'default',
  style,
}: TabsProps) {
  const [internalActiveKey, setInternalActiveKey] = useState(
    defaultActiveKey || tabs[0]?.key || ''
  );

  const activeKey = controlledActiveKey ?? internalActiveKey;
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleTabClick = useCallback(
    (key: string) => {
      if (controlledActiveKey === undefined) {
        setInternalActiveKey(key);
      }
      onChange?.(key);
    },
    [controlledActiveKey, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentIndex: number) => {
      const enabledTabs = tabs.filter((t) => !t.disabled);
      const currentEnabledIndex = enabledTabs.findIndex(
        (t) => t.key === tabs[currentIndex].key
      );

      let nextIndex = -1;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (currentEnabledIndex + 1) % enabledTabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex =
          (currentEnabledIndex - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = enabledTabs.length - 1;
      }

      if (nextIndex >= 0) {
        const nextTab = enabledTabs[nextIndex];
        tabRefs.current.get(nextTab.key)?.focus();
        handleTabClick(nextTab.key);
      }
    },
    [tabs, handleTabClick]
  );

  const getTabStyle = (isActive: boolean, isDisabled: boolean) => {
    const base = isActive ? activeTabStyle : baseTabStyle;
    return isDisabled ? { ...base, ...disabledTabStyle } : base;
  };

  const activeTab = tabs.find((t) => t.key === activeKey);

  return (
    <div style={{ ...containerStyle, ...style }}>
      <div role="tablist" style={tabListStyle}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.key, el);
            }}
            role="tab"
            aria-selected={activeKey === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={activeKey === tab.key ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && handleTabClick(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={getTabStyle(activeKey === tab.key, !!tab.disabled)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${activeKey}`}
        aria-labelledby={activeKey}
      >
        {activeTab?.content}
      </div>
    </div>
  );
}
