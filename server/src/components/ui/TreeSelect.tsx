import React, { useState, useEffect } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { AutomationProps } from '../../types/ui-reflection/types';

export interface TreeSelectOption<T extends string = string> {
  label: string;
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
  triggerClassName = 'hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent',
  contentClassName = 'bg-white rounded-md shadow-lg border border-gray-200',
  multiSelect = false,
  showExclude = false,
  showReset = false,
  allowEmpty = false,
}: TreeSelectProps<T>): JSX.Element {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value);
  const [displayLabel, setDisplayLabel] = useState<string>('');

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
    
    if (value) {
      setSelectedValue(value);
      const result = findSelectedOptionWithPath(options, value);
      if (result) {
        // Expand all parent nodes
        setExpandedItems(prev => {
          const next = new Set(prev);
          result.path.forEach((p: TreeSelectOption<T>): void => {
            next.add(p.value);
          });
          return next;
        });

        // Build the path object
        const pathObj: TreeSelectPath = {};
        result.path.forEach((opt: TreeSelectOption<T>): void => {
          pathObj[opt.type] = opt.value;
        });

        // Set display label to show the full path
        const labels = result.path.map((p: TreeSelectOption<T>): string => p.label);
        setDisplayLabel(labels.join(' > '));
      }
    }
  }, [value, options]);

  const toggleExpand = (optionValue: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(optionValue)) {
        next.delete(optionValue);
      } else {
        next.add(optionValue);
      }
      return next;
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

    const pathObj = buildPathObject(option, ancestors);
    onValueChange(option.value, option.type, false, pathObj);

    if (!multiSelect || (!option.children?.length && !showExclude)) {
      setIsOpen(false);
    }
  };

  const handleExclude = (option: TreeSelectOption<T>, ancestors: TreeSelectOption<T>[], e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    
    const pathObj = buildPathObject(option, ancestors);
    onValueChange(option.value, option.type, true, pathObj);
  };

  const handleReset = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    onValueChange('', '' as T, false);
    setSelectedValue('');
    setDisplayLabel('');
    setIsOpen(false);
  };

  const renderOption = (
    option: TreeSelectOption<T>, 
    level: number = 0,
    ancestors: TreeSelectOption<T>[] = []
  ): JSX.Element => {
    const isExpanded = expandedItems.has(option.value);
    const hasChildren = option.children && option.children.length > 0;

    return (
      <React.Fragment key={option.value}>
        <div
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
                  <button
                    type="button"
                    className={`
                      p-1 rounded hover:bg-gray-200 transition-colors
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
                  </button>
                )}
                {showExclude && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`
                        p-1 rounded hover:bg-gray-200 transition-colors
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
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {isExpanded && option.children?.map((child: TreeSelectOption<T>): JSX.Element => 
          renderOption(child, level + 1, [...ancestors, option])
        )}
      </React.Fragment>
    );
  };

  const hasSelections = options.some(opt => opt.selected || opt.excluded);

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
          onOpenChange={setIsOpen}
          disabled={disabled || !Array.isArray(options) || options.length === 0}
        >
          <RadixSelect.Trigger
            className={`
              inline-flex items-center justify-between
              border border-gray-200 rounded-lg p-2
              bg-white cursor-pointer min-h-[38px]
              disabled:opacity-50 disabled:cursor-not-allowed
              text-sm w-full
              ${triggerClassName}
              ${className}
            `}
          >
            <RadixSelect.Value 
              placeholder={placeholder}
              className="flex-1 text-left"
            >
              {displayLabel || placeholder}
            </RadixSelect.Value>
            <div className="flex items-center gap-2">
              {showReset && hasSelections && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="p-1 hover:bg-gray-100 rounded-full"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
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
                {options.map((option: TreeSelectOption<T>): JSX.Element => renderOption(option))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      </div>
    </div>
  );
}

export default TreeSelect;
