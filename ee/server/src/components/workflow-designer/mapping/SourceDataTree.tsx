'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Package,
  Variable,
  Hash,
  ToggleLeft,
  List,
  Braces,
  FileText,
  AlertTriangle,
  Tag,
  Search,
  Pin,
  PinOff,
  GripVertical
} from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  TypeCompatibility,
  getTypeCompatibility,
  getCompatibilityClasses,
  getCompatibilityLabel
} from './typeCompatibility';
import {
  type DragItem,
  type MappingDndHandlers,
  setDragData
} from './useMappingDnd';

/**
 * Schema field structure for tree display
 */
export interface DataField {
  name: string;
  path: string;
  type: string;
  description?: string;
  required?: boolean;
  nullable?: boolean;
  children?: DataField[];
  source: 'payload' | 'vars' | 'meta' | 'error' | 'forEach';
  stepName?: string; // For vars - which step produced this
}

/**
 * Data context passed to the tree
 */
export interface DataTreeContext {
  payload: DataField[];
  vars: Array<{
    stepId: string;
    stepName: string;
    saveAs: string;
    fields: DataField[];
  }>;
  meta: DataField[];
  error: DataField[];
  forEach?: {
    itemVar: string;
    indexVar: string;
    itemType?: string;
  };
}

export interface SourceDataTreeProps {
  /**
   * Available data context
   */
  context: DataTreeContext;

  /**
   * Callback when a field is selected
   */
  onSelectField: (path: string) => void;

  /**
   * Currently selected path (for highlighting)
   */
  selectedPath?: string;

  /**
   * Whether the tree is disabled
   */
  disabled?: boolean;

  /**
   * Maximum height for scrollable container
   */
  maxHeight?: string;

  /**
   * Fixed height for the full tree container (enables aligned column heights)
   */
  height?: string;

  /**
   * §19.1 - Target field type for compatibility highlighting
   * When set, source fields will be color-coded by compatibility
   */
  targetType?: string;

  /**
   * §19.2 - Drag-and-drop handlers for mapping (always enabled)
   */
  dndHandlers: MappingDndHandlers;

  /**
   * §19.3 - Callback to register element refs for connection lines
   */
  onRegisterRef?: (path: string, element: HTMLElement | null) => void;

  /**
   * §19.3 - Register/unregister scroll container for position tracking
   */
  onRegisterScrollContainer?: (element: HTMLElement | null) => void;
  onUnregisterScrollContainer?: (element: HTMLElement | null) => void;
}

// Type icons by field type
const getTypeIcon = (type: string) => {
  switch (type.toLowerCase()) {
    case 'string':
      return <FileText className="w-3.5 h-3.5 text-emerald-600" />;
    case 'number':
    case 'integer':
      return <Hash className="w-3.5 h-3.5 text-blue-600" />;
    case 'boolean':
      return <ToggleLeft className="w-3.5 h-3.5 text-purple-600" />;
    case 'array':
      return <List className="w-3.5 h-3.5 text-orange-600" />;
    case 'object':
      return <Braces className="w-3.5 h-3.5 text-gray-600" />;
    default:
      return <Variable className="w-3.5 h-3.5 text-gray-400" />;
  }
};

// Source icons by category
const getSourceIcon = (source: DataField['source']) => {
  switch (source) {
    case 'payload':
      return <Package className="w-4 h-4 text-indigo-600" />;
    case 'vars':
      return <Variable className="w-4 h-4 text-green-600" />;
    case 'meta':
      return <Tag className="w-4 h-4 text-gray-600" />;
    case 'error':
      return <AlertTriangle className="w-4 h-4 text-red-600" />;
    case 'forEach':
      return <List className="w-4 h-4 text-orange-600" />;
    default:
      return null;
  }
};

/**
 * Individual tree node component
 */
const TreeNode: React.FC<{
  field: DataField;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath?: string;
  disabled?: boolean;
  searchQuery?: string;
  pinnedPaths: Set<string>;
  onTogglePin: (path: string) => void;
  targetType?: string;
  dndHandlers: MappingDndHandlers;
  onRegisterRef?: (path: string, element: HTMLElement | null) => void;
}> = ({
  field,
  depth,
  onSelect,
  selectedPath,
  disabled,
  searchQuery,
  pinnedPaths,
  onTogglePin,
  targetType,
  dndHandlers,
  onRegisterRef
}) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = field.children && field.children.length > 0;
  const isSelected = selectedPath === field.path;
  const isPinned = pinnedPaths.has(field.path);
  const isLeaf = !hasChildren;

  // §19.1 - Calculate type compatibility if target type is specified
  const compatibility = useMemo(() => {
    if (!targetType || !field.type) return null;
    return getTypeCompatibility(field.type, targetType);
  }, [field.type, targetType]);

  const compatClasses = compatibility ? getCompatibilityClasses(compatibility) : null;

  // Check if this node or any children match the search
  const matchesSearch = useCallback((f: DataField, query: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (f.name.toLowerCase().includes(q)) return true;
    if (f.path.toLowerCase().includes(q)) return true;
    if (f.description?.toLowerCase().includes(q)) return true;
    return f.children?.some(c => matchesSearch(c, query)) ?? false;
  }, []);

  const visible = !searchQuery || matchesSearch(field, searchQuery);
  if (!visible) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onSelect(field.path);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(field.path);
  };

  // §19.2 - Drag start handler
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) return;

    const item: DragItem = {
      path: field.path,
      type: field.type,
      name: field.name
    };

    setDragData(e, item);
    dndHandlers.handleDragStart(item);

    // Add a drag image
    if (e.currentTarget instanceof HTMLElement) {
      const rect = e.currentTarget.getBoundingClientRect();
      e.dataTransfer.setDragImage(e.currentTarget, rect.width / 2, rect.height / 2);
    }
  };

  const handleDragEnd = () => {
    dndHandlers.handleDragEnd();
  };

  // §19.1 - Determine if field should be dimmed based on compatibility
  const isDimmed = targetType && compatibility === TypeCompatibility.INCOMPATIBLE;

  return (
    <div className="select-none">
      <div
        ref={(el) => {
          if (isLeaf && onRegisterRef) {
            onRegisterRef(field.path, el);
          }
        }}
        onClick={handleClick}
        draggable={isLeaf && !disabled}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`
          flex items-center gap-1 py-1 px-2 rounded cursor-pointer group
          ${isSelected ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${isDimmed ? 'opacity-40' : ''}
          ${isLeaf && !disabled ? 'cursor-grab active:cursor-grabbing' : ''}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={field.description || field.path}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className="p-0.5 hover:bg-gray-200 rounded"
            disabled={disabled}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {/* Type icon */}
        {getTypeIcon(field.type)}

        {/* Field name */}
        <span className="text-sm font-medium text-gray-800 flex-1 truncate">
          {field.name}
        </span>

        {/* Type badge */}
        <span className="text-xs text-gray-400 hidden group-hover:inline">
          {field.type}
        </span>

        {/* §19.1 - Type compatibility badge */}
        {isLeaf && targetType && compatibility && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${compatClasses?.bg || ''} ${compatClasses?.text || ''}`}
            title={getCompatibilityLabel(compatibility)}
          >
            {compatibility === TypeCompatibility.EXACT ? '✓' :
             compatibility === TypeCompatibility.COERCIBLE ? '~' :
             compatibility === TypeCompatibility.INCOMPATIBLE ? '✗' : '?'}
          </span>
        )}

        {/* §19.2 - Drag handle for draggable fields */}
        {isLeaf && !disabled && (
          <GripVertical className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab" />
        )}

        {/* Required indicator */}
        {field.required && (
          <span className="text-red-500 text-xs">*</span>
        )}

        {/* Nullable indicator */}
        {field.nullable && (
          <Badge className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0">?</Badge>
        )}

        {/* Pin button */}
        <button
          onClick={handlePin}
          className={`p-0.5 rounded opacity-0 group-hover:opacity-100 ${isPinned ? 'opacity-100 text-yellow-600' : 'text-gray-400 hover:text-gray-600'}`}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          {isPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
        </button>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {field.children!.map((child) => (
            <TreeNode
              key={child.path}
              field={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
              disabled={disabled}
              searchQuery={searchQuery}
              pinnedPaths={pinnedPaths}
              onTogglePin={onTogglePin}
              targetType={targetType}
              dndHandlers={dndHandlers}
              onRegisterRef={onRegisterRef}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Section header for grouping data sources
 */
const SectionHeader: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, icon, count, expanded, onToggle }) => (
  <button
    onClick={onToggle}
    className="flex items-center gap-2 w-full py-2 px-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-left"
  >
    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    {icon}
    <span className="text-sm font-semibold text-gray-700 flex-1">{title}</span>
    <Badge className="text-xs bg-gray-200 text-gray-600">{count}</Badge>
  </button>
);

/**
 * SourceDataTree component
 *
 * Visual tree browser for available workflow data context.
 * Shows payload fields, vars from previous steps, meta fields,
 * and error fields with expandable/collapsible tree structure.
 */
export const SourceDataTree: React.FC<SourceDataTreeProps> = ({
  context,
  onSelectField,
  selectedPath,
  disabled,
  maxHeight = '400px',
  height,
  targetType,
  dndHandlers,
  onRegisterRef,
  onRegisterScrollContainer,
  onUnregisterScrollContainer
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    payload: true,
    vars: true,
    meta: false,
    error: false,
    forEach: true
  });
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(new Set());
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!onRegisterScrollContainer || !scrollContainerRef.current) return;
    const element = scrollContainerRef.current;
    onRegisterScrollContainer(element);
    return () => {
      onUnregisterScrollContainer?.(element);
    };
  }, [onRegisterScrollContainer, onUnregisterScrollContainer]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const togglePin = useCallback((path: string) => {
    setPinnedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Convert context to flat list for pinned items
  const allFields = useMemo(() => {
    const fields: DataField[] = [];
    const addFields = (list: DataField[]) => {
      list.forEach(f => {
        fields.push(f);
        if (f.children) addFields(f.children);
      });
    };
    addFields(context.payload);
    context.vars.forEach(v => addFields(v.fields));
    addFields(context.meta);
    addFields(context.error);
    return fields;
  }, [context]);

  const pinnedFields = useMemo(() =>
    allFields.filter(f => pinnedPaths.has(f.path)),
    [allFields, pinnedPaths]
  );

  const countFields = (fields: DataField[]): number => {
    return fields.reduce((acc, f) => acc + 1 + (f.children ? countFields(f.children) : 0), 0);
  };

  return (
    <div
      className="border border-gray-200 rounded-lg bg-white flex flex-col"
      style={height ? { height } : undefined}
    >
      {/* Search input */}
      <div className="p-2 border-b border-gray-200">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            id="source-data-tree-search"
            placeholder="Search fields..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Tree content */}
      <div
        className="overflow-y-auto flex-1"
        style={height ? undefined : { maxHeight }}
        ref={scrollContainerRef}
      >
        {/* Pinned fields */}
        {pinnedFields.length > 0 && (
          <div className="p-2 border-b border-gray-200 bg-yellow-50">
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-yellow-800">
              <Pin className="w-3.5 h-3.5" />
              Pinned Fields
            </div>
            {pinnedFields.map(field => (
              <div
                key={field.path}
                onClick={() => !disabled && onSelectField(field.path)}
                className={`
                  flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-sm
                  ${selectedPath === field.path ? 'bg-yellow-200' : 'hover:bg-yellow-100'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                {getTypeIcon(field.type)}
                <span className="truncate">{field.path}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePin(field.path); }}
                  className="ml-auto text-yellow-600 hover:text-yellow-800"
                >
                  <Pin className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="p-2 space-y-2">
          {/* Payload section */}
          {context.payload.length > 0 && (
            <div>
              <SectionHeader
                title="Payload"
                icon={<Package className="w-4 h-4 text-indigo-600" />}
                count={countFields(context.payload)}
                expanded={expandedSections.payload}
                onToggle={() => toggleSection('payload')}
              />
              {expandedSections.payload && (
                <div className="mt-1">
                  {context.payload.map(field => (
                    <TreeNode
                      key={field.path}
                      field={field}
                      depth={0}
                      onSelect={onSelectField}
                      selectedPath={selectedPath}
                      disabled={disabled}
                      searchQuery={searchQuery}
                      pinnedPaths={pinnedPaths}
                      onTogglePin={togglePin}
                      targetType={targetType}
                      dndHandlers={dndHandlers}
                      onRegisterRef={onRegisterRef}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Vars section (from previous steps) */}
          <div>
            <SectionHeader
              title="Step Outputs (vars)"
              icon={<Variable className="w-4 h-4 text-green-600" />}
              count={context.vars.reduce((acc, v) => acc + countFields(v.fields) + 1, 0)}
              expanded={expandedSections.vars}
              onToggle={() => toggleSection('vars')}
            />
            {expandedSections.vars && (
              <div className="mt-1 space-y-1">
                {context.vars.length === 0 ? (
                  <div className="text-xs text-gray-500 px-2 py-2 ml-4">
                    No vars yet. Use <span className="font-medium">Save output</span> or an <span className="font-medium">Assign</span> step to populate <code className="font-mono">vars.&lt;name&gt;</code>.
                  </div>
                ) : (
                  context.vars.map(stepVar => {
                    const stepVarPath = `vars.${stepVar.saveAs}`;
                    return (
                      <div key={stepVar.stepId} className="border-l-2 border-green-200 ml-2">
                        <div
                          ref={(el) => {
                            onRegisterRef?.(stepVarPath, el);
                          }}
                          onClick={() => !disabled && onSelectField(stepVarPath)}
                          draggable={!disabled}
                          onDragStart={(e) => {
                            if (disabled) return;
                            const item: DragItem = {
                              path: stepVarPath,
                              type: 'object',
                              name: stepVar.saveAs
                            };
                            setDragData(e, item);
                            dndHandlers.handleDragStart(item);
                            if (e.currentTarget instanceof HTMLElement) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              e.dataTransfer.setDragImage(e.currentTarget, rect.width / 2, rect.height / 2);
                            }
                          }}
                          onDragEnd={() => {
                            dndHandlers.handleDragEnd();
                          }}
                          className={`
                            flex items-center gap-2 py-1 px-2 rounded cursor-pointer group
                            ${selectedPath === stepVarPath ? 'bg-green-100' : 'hover:bg-gray-50'}
                            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                            ${!disabled ? 'cursor-grab active:cursor-grabbing' : ''}
                          `}
                        >
                          <Braces className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-sm font-medium text-gray-800">
                            {stepVarPath}
                          </span>
                          <span className="text-xs text-gray-500">
                            ({stepVar.stepName})
                          </span>
                        </div>
                        {stepVar.fields.map(field => (
                          <TreeNode
                            key={field.path}
                            field={field}
                            depth={1}
                            onSelect={onSelectField}
                            selectedPath={selectedPath}
                            disabled={disabled}
                            searchQuery={searchQuery}
                            pinnedPaths={pinnedPaths}
                            onTogglePin={togglePin}
                            targetType={targetType}
                            dndHandlers={dndHandlers}
                            onRegisterRef={onRegisterRef}
                          />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* forEach context */}
          {context.forEach && (
            <div>
              <SectionHeader
                title="Loop Context"
                icon={<List className="w-4 h-4 text-orange-600" />}
                count={2}
                expanded={expandedSections.forEach}
                onToggle={() => toggleSection('forEach')}
              />
              {expandedSections.forEach && (
                <div className="mt-1">
                  <div
                    onClick={() => !disabled && onSelectField(context.forEach!.itemVar)}
                    className={`
                      flex items-center gap-2 py-1 px-2 ml-6 rounded cursor-pointer
                      ${selectedPath === context.forEach.itemVar ? 'bg-orange-100' : 'hover:bg-gray-50'}
                    `}
                  >
                    {getTypeIcon(context.forEach.itemType || 'any')}
                    <span className="text-sm font-medium text-gray-800">
                      {context.forEach.itemVar}
                    </span>
                    <Badge className="text-xs bg-orange-100 text-orange-700">current item</Badge>
                  </div>
                  <div
                    onClick={() => !disabled && onSelectField(context.forEach!.indexVar)}
                    className={`
                      flex items-center gap-2 py-1 px-2 ml-6 rounded cursor-pointer
                      ${selectedPath === context.forEach.indexVar ? 'bg-orange-100' : 'hover:bg-gray-50'}
                    `}
                  >
                    <Hash className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-sm font-medium text-gray-800">
                      {context.forEach.indexVar}
                    </span>
                    <Badge className="text-xs bg-blue-100 text-blue-700">loop index</Badge>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Meta section */}
          {context.meta.length > 0 && (
            <div>
              <SectionHeader
                title="Workflow Meta"
                icon={<Tag className="w-4 h-4 text-gray-600" />}
                count={context.meta.length}
                expanded={expandedSections.meta}
                onToggle={() => toggleSection('meta')}
              />
              {expandedSections.meta && (
                <div className="mt-1">
                  {context.meta.map(field => (
                    <TreeNode
                      key={field.path}
                      field={field}
                      depth={0}
                      onSelect={onSelectField}
                      selectedPath={selectedPath}
                      disabled={disabled}
                      searchQuery={searchQuery}
                      pinnedPaths={pinnedPaths}
                      onTogglePin={togglePin}
                      targetType={targetType}
                      dndHandlers={dndHandlers}
                      onRegisterRef={onRegisterRef}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error section */}
          {context.error.length > 0 && (
            <div>
              <SectionHeader
                title="Error Context"
                icon={<AlertTriangle className="w-4 h-4 text-red-600" />}
                count={context.error.length}
                expanded={expandedSections.error}
                onToggle={() => toggleSection('error')}
              />
              {expandedSections.error && (
                <div className="mt-1">
                  {context.error.map(field => (
                    <TreeNode
                      key={field.path}
                      field={field}
                      depth={0}
                      onSelect={onSelectField}
                      selectedPath={selectedPath}
                      disabled={disabled}
                      searchQuery={searchQuery}
                      pinnedPaths={pinnedPaths}
                      onTogglePin={togglePin}
                      targetType={targetType}
                      dndHandlers={dndHandlers}
                      onRegisterRef={onRegisterRef}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceDataTree;
