import React, { useState, useEffect, useSyncExternalStore, useRef } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useModality } from './ModalityContext';
import { AutomationProps } from '../../types/ui-reflection/types';
import { Button } from './Button';
import Spinner from './Spinner';

// Hook to detect if we're on the client (after hydration)
const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export interface TreeSelectOption<T extends string = string> {
  label: string | React.ReactNode;
  value: string;
  type: T;
  children?: TreeSelectOption<T>[];
  excluded?: boolean;
  selected?: boolean;
}

export interface TreeSelectPath {
  [key: string]: string;
}

interface TreeSelectProps<T extends string = string> extends AutomationProps {
  options: TreeSelectOption<T>[];
  value: string;
  onValueChange: (value: string, type: T, excluded: boolean, path?: TreeSelectPath) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  selectedClassName?: string;
  hoverClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
  multiSelect?: boolean;
  showExclude?: boolean;
  showReset?: boolean;
  allowEmpty?: boolean;
  modal?: boolean;
}

function TreeSelect<T extends string>({
  options = [],
  value,
  onValueChange,
  placeholder,
  className,
  disabled,
  label,
  selectedClassName = 'bg-gray-50',
  hoverClassName = 'hover:bg-gray-50',
  triggerClassName = 'hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent',
  contentClassName = 'bg-white rounded-md shadow-lg border border-gray-200',
  multiSelect = false,
  showExclude = false,
  showReset = false,
  allowEmpty = false,
  modal,
}: TreeSelectProps<T>): JSX.Element {
  const { modal: parentModal } = useModality();
  const isClient = useIsClient();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value);
  const [displayLabel, setDisplayLabel] = useState<string>('');

  // Explicit prop overrides parent modality context
  const isModal = modal !== undefined ? modal : parentModal;

  // Track when we're handling internal clicks to prevent Radix from closing prematurely
  const isHandlingInternalClick = useRef(false);

  // Track if this is the initial mount - only auto-expand parents on first render
  const hasInitializedRef = useRef(false);

  // Find the selected option and its ancestors
  const findSelectedOptionWithPath = (
    opts: TreeSelectOption<T>[],
    targetValue: string,
    parentPath: TreeSelectOption<T>[] = []
  ): { option: TreeSelectOption<T>; path: TreeSelectOption<T>[] } | undefined => {
    for (const opt of opts) {
      const currentPath = [...parentPath, opt];
      if (opt.value === targetValue) {
        return { option: opt, path: currentPath };
      }
      if (opt.children) {
        const found = findSelectedOptionWithPath(opt.children, targetValue, currentPath);
        if (found) return found;
      }
    }
    return undefined;
  };

  // Update expanded items and display label when value changes
  useEffect(() => {
    if (!Array.isArray(options)) {
      console.error('TreeSelect: options is not an array', options);
      return;
    }

    // If value is empty, clear selection and label
    if (!value) {
      setSelectedValue('');
      setDisplayLabel('');
      if (!hasInitializedRef.current) {
        setExpandedItems(new Set());
        hasInitializedRef.current = true;
      }
      return;
    }

    // Otherwise, find and reflect the selected option
    setSelectedValue(value);
    const result = findSelectedOptionWithPath(options, value);
    if (result) {
      // Only auto-expand parent nodes on initial mount, not on subsequent renders
      // This allows users to collapse categories while keeping their selection
      if (!hasInitializedRef.current) {
        setExpandedItems(prev => {
          const next = new Set(prev);
          result.path.forEach((p: TreeSelectOption<T>): void => {
            next.add(p.value);
          });
          return next;
        });
        hasInitializedRef.current = true;
      }

      // Build the path object (not used directly here, but kept for parity)
      const pathObj: TreeSelectPath = {};
      result.path.forEach((opt: TreeSelectOption<T>): void => {
        pathObj[opt.type] = opt.value;
      });

      // Set display label to show the full path
      const labels = result.path.map((p: TreeSelectOption<T>): string => {
        if (typeof p.label === 'string') {
          return p.label;
        }
        // If label is JSX (e.g., with ITIL badge), extract the text content
        if (React.isValidElement(p.label) && p.label.props.children) {
          const children = p.label.props.children;
          if (Array.isArray(children)) {
            // Find the text content (usually the first string element)
            const textContent = children.find(child => typeof child === 'string');
            if (textContent) return textContent;
          } else if (typeof children === 'string') {
            return children;
          }
        }
        return ''; // Don't fall back to value (UUID)
      });
      setDisplayLabel(labels.filter(l => l).join(' > '));
    }
  }, [value, options]);

  const toggleExpand = (optionValue: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isHandlingInternalClick.current = true;
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(optionValue)) {
        next.delete(optionValue);
      } else {
        next.add(optionValue);
      }
      return next;
    });
    // Reset the flag after a microtask to allow Radix's onOpenChange to be ignored
    Promise.resolve().then(() => {
      isHandlingInternalClick.current = false;
    });
  };

  const buildPathObject = (option: TreeSelectOption<T>, ancestors: TreeSelectOption<T>[]): TreeSelectPath => {
    const fullPath = [...ancestors, option];
    const pathObj: TreeSelectPath = {};
    fullPath.forEach((opt: TreeSelectOption<T>): void => {
      pathObj[opt.type] = opt.value;
    });
    return pathObj;
  };

  const handleSelect = (option: TreeSelectOption<T>, ancestors: TreeSelectOption<T>[], e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    isHandlingInternalClick.current = true;

    const pathObj = buildPathObject(option, ancestors);
    onValueChange(option.value, option.type, false, pathObj);

    // For single-select without children/exclude options, close the dropdown
    const shouldClose = !multiSelect || (!option.children?.length && !showExclude);

    // Reset the flag after a microtask, then close if needed
    Promise.resolve().then(() => {
      isHandlingInternalClick.current = false;
      if (shouldClose) {
        setIsOpen(false);
      }
    });
  };

  const handleExclude = (option: TreeSelectOption<T>, ancestors: TreeSelectOption<T>[], e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    isHandlingInternalClick.current = true;

    const pathObj = buildPathObject(option, ancestors);
    onValueChange(option.value, option.type, true, pathObj);

    // Reset the flag after a microtask - exclude should not close the dropdown
    Promise.resolve().then(() => {
      isHandlingInternalClick.current = false;
    });
  };

  const handleReset = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    isHandlingInternalClick.current = true;

    onValueChange('', '' as T, false);
    setSelectedValue('');
    setDisplayLabel('');

    // Reset the flag after a microtask, then close
    Promise.resolve().then(() => {
      isHandlingInternalClick.current = false;
      setIsOpen(false);
    });
  };

  // Wrapper for Radix's onOpenChange to prevent premature closing during internal clicks
  const handleOpenChange = (open: boolean) => {
    // If Radix is trying to close but we're handling an internal click, ignore it
    if (!open && isHandlingInternalClick.current) {
      return;
    }
    setIsOpen(open);
  };

  const renderOption = (
    option: TreeSelectOption<T>,
    level: number = 0,
    ancestors: TreeSelectOption<T>[] = []
  ): JSX.Element[] => {
    const isExpanded = expandedItems.has(option.value);
    const hasChildren = option.children && option.children.length > 0;

    const elements: JSX.Element[] = [];

    elements.push(
      <div
        key={option.value}
        className={`
            relative flex items-center py-2 text-sm rounded text-gray-900
            bg-white select-none whitespace-nowrap pl-3
            ${hoverClassName}
            ${option.selected ? selectedClassName : ''}
          `}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between w-full pr-2">
            <div className="flex items-center min-w-0">
              {hasChildren && (
                <div 
                  className="flex-shrink-0 cursor-pointer p-0.5 hover:text-gray-900 rounded transition-colors mr-1"
                  onClick={(e) => toggleExpand(option.value, e)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  )}
                </div>
              )}
              {!hasChildren && <div className="w-5" />}
              <div 
                className={`
                  cursor-pointer truncate
                  ${option.excluded ? 'line-through text-red-500' : ''}
                  ${option.selected ? 'text-purple-600' : ''}
                `}
                onClick={(e) => handleSelect(option, ancestors, e)}
              >
                {option.label}
              </div>
            </div>
            {(multiSelect || showExclude) && (
              <div className="flex items-center gap-1 ml-2">
                {multiSelect && (
                  <Button
                    id={`include-${option.value}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`
                      p-1 h-auto min-h-0
                      ${option.selected ? 'text-purple-500' : 'text-gray-400'}
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(option, ancestors, e);
                    }}
                    title="Include category"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </Button>
                )}
                {showExclude && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Button
                      id={`exclude-${option.value}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`
                        p-1 h-auto min-h-0
                        ${option.excluded ? 'text-red-500' : 'text-gray-400'}
                      `}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleExclude(option, ancestors, e);
                      }}
                      title="Exclude category"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
      </div>
    );

    if (isExpanded && option.children) {
      option.children.forEach((child: TreeSelectOption<T>) => {
        elements.push(...renderOption(child, level + 1, [...ancestors, option]));
      });
    }

    return elements;
  };

  const hasSelections = options.some(opt => opt.selected || opt.excluded);

  // Render a loading state during SSR to avoid hydration mismatch
  // caused by Radix UI's useId() generating different IDs on server vs client
  if (!isClient) {
    return (
      <div className={label ? 'mb-4' : ''}>
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          <div
            className={`
              inline-flex items-center justify-center
              border border-[rgb(var(--color-border-400))] rounded-lg p-2
              bg-white min-h-[38px]
              text-sm w-full
              ${className}
            `}
          >
            <Spinner size="xs" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={label ? 'mb-4' : ''}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <RadixSelect.Root
          value={selectedValue}
          open={isOpen}
          onOpenChange={handleOpenChange}
          disabled={disabled}
          {...({ modal: isModal } as any)}
        >
          <RadixSelect.Trigger
            className={`
              inline-flex items-center justify-between
              border border-[rgb(var(--color-border-400))] rounded-lg p-2
              bg-white min-h-[38px]
              ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
              text-sm w-full
              ${triggerClassName}
              ${className}
            `}
          >
            <RadixSelect.Value 
              placeholder={placeholder}
              className="flex-1 text-left"
            >
              <span className={!displayLabel ? 'text-gray-400' : ''}>
                {displayLabel || placeholder}
              </span>
            </RadixSelect.Value>
            <div className="flex items-center gap-2">
              {showReset && hasSelections && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReset(e);
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full cursor-pointer"
                  role="button"
                  aria-label="Clear selection"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </div>
              )}
              <RadixSelect.Icon>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </RadixSelect.Icon>
            </div>
          </RadixSelect.Trigger>

          <RadixSelect.Portal>
            <RadixSelect.Content
              className={`overflow-hidden mt-1 z-[60] w-fit min-w-[200px] ${contentClassName}`}
              position="popper"
              sideOffset={4}
              align="start"
              avoidCollisions={true}
              sticky="always"
            >
              <RadixSelect.Viewport className="p-1 max-h-[300px] overflow-y-auto">
                {allowEmpty && (
                  <div
                    className={`
                      relative flex items-center py-2 text-sm rounded text-gray-900
                      bg-white select-none whitespace-nowrap pl-3 cursor-pointer
                      ${hoverClassName}
                    `}
                    onClick={handleReset}
                  >
                    Clear selection
                  </div>
                )}
                {options.flatMap((option: TreeSelectOption<T>) => renderOption(option))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      </div>
    </div>
  );
}

export default TreeSelect;
