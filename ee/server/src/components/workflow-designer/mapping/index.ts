export {
  InputMappingEditor,
  type InputMappingEditorProps,
  type ActionInputField
} from './InputMappingEditor';

export {
  SourceDataTree,
  type SourceDataTreeProps,
  type DataField,
  type DataTreeContext
} from './SourceDataTree';

export {
  ValidationBadge,
  type ValidationBadgeProps,
  type ValidationStatus
} from './ValidationBadge';

// §19.1 - Type Compatibility System
export {
  TypeCompatibility,
  COMPATIBILITY_COLORS,
  COMPATIBILITY_CLASSES,
  getCompatibilityColor,
  getCompatibilityClasses,
  getCompatibilityLabel,
  getTypeCompatibility,
  inferTypeFromJsonSchema,
  getDisplayTypeName,
  sortByCompatibility,
  groupByCompatibility,
  type JsonSchemaType
} from './typeCompatibility';

// §19.2 - Drag-and-Drop
export {
  useMappingDnd,
  MAPPING_DND_MIME_TYPE,
  createDragData,
  parseDragData,
  setDragData,
  getDragData,
  hasDragData,
  createDraggableProps,
  createDropTargetProps,
  getDropTargetClasses,
  getDropZoneIcon,
  type DragItem,
  type MappingDndState,
  type MappingDndHandlers,
  type UseMappingDndOptions,
  type DraggableProps,
  type DropTargetProps
} from './useMappingDnd';

// §19.3 - Visual Connection Lines
export {
  useMappingPositions,
  calculateBezierPath,
  calculateBezierPathWithOffset,
  type FieldRect,
  type MappingConnection,
  type MappingPositionsState,
  type MappingPositionsHandlers,
  type UseMappingPositionsOptions
} from './useMappingPositions';

export {
  MappingConnectionsOverlay,
  type ConnectionData,
  type MappingConnectionsOverlayProps
} from './MappingConnectionsOverlay';

// §19.6 - Loading and Error States
export {
  MappingEditorSkeleton,
  MappingEditorError,
  type MappingEditorSkeletonProps,
  type MappingEditorErrorProps
} from './MappingEditorSkeleton';

// §17.3 - Keyboard Navigation
export {
  useMappingKeyboard,
  type MappingKeyboardState,
  type MappingKeyboardHandlers,
  type NavigableFieldProps,
  type UseMappingKeyboardOptions
} from './useMappingKeyboard';

// §16.2 - Expression Autocomplete
export {
  ExpressionAutocomplete,
  buildSuggestionsFromContext,
  calculateDropdownPosition,
  type ExpressionAutocompleteProps
} from './ExpressionAutocomplete';

export {
  extractCurrentPath,
  filterSuggestions,
  type AutocompleteSuggestion
} from './expressionAutocompleteUtils';

export {
  useExpressionAutocomplete,
  type UseExpressionAutocompleteOptions,
  type ExpressionAutocompleteState,
  type ExpressionAutocompleteHandlers
} from './useExpressionAutocomplete';

export {
  ExpressionTextArea,
  type ExpressionTextAreaProps,
  type DataContextField
} from './ExpressionTextArea';

// §19 - Composite Mapping Panel
export {
  MappingPanel,
  type MappingPanelProps,
  type WorkflowDataContext
} from './MappingPanel';
