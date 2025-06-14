/**
 * Security whitelist for extension descriptors
 * This ensures only safe props and attributes are passed through
 */

/**
 * Allowed HTML attributes for descriptors
 */
export const ALLOWED_HTML_ATTRIBUTES = new Set([
  // Core attributes
  'id',
  'className',
  'style',
  'title',
  'role',
  'tabIndex',
  
  // ARIA attributes
  'aria-label',
  'aria-hidden',
  'aria-expanded',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-live',
  'aria-atomic',
  'aria-busy',
  'aria-checked',
  'aria-current',
  'aria-disabled',
  'aria-invalid',
  'aria-pressed',
  'aria-readonly',
  'aria-required',
  'aria-selected',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
  
  // Data attributes (controlled)
  'data-testid',
  'data-component',
  'data-icon',
  
  // Link attributes
  'href',
  'target',
  'rel',
  'download',
  
  // Form attributes
  'type',
  'name',
  'value',
  'placeholder',
  'disabled',
  'checked',
  'readonly',
  'required',
  'multiple',
  'pattern',
  'min',
  'max',
  'step',
  'minLength',
  'maxLength',
  'autoComplete',
  'autoFocus',
  'accept',
  'capture',
  
  // Input specific
  'inputMode',
  'list',
  
  // Textarea specific
  'rows',
  'cols',
  'wrap',
  
  // Select/Option specific
  'selected',
  'defaultValue',
  'size',
  
  // Image/Media attributes
  'src',
  'alt',
  'width',
  'height',
  'loading',
  'decoding',
  'crossOrigin',
  'referrerPolicy',
  
  // Table attributes
  'colspan',
  'rowspan',
  'scope',
  'headers',
  
  // Button attributes
  'form',
  'formAction',
  'formEncType',
  'formMethod',
  'formNoValidate',
  'formTarget',
  
  // Meta attributes
  'lang',
  'dir',
  'translate',
  'spellCheck',
  'contentEditable',
  'draggable',
  'hidden'
]);

/**
 * Allowed style properties
 */
export const ALLOWED_STYLE_PROPERTIES = new Set([
  // Display & Positioning
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'clear',
  'zIndex',
  'overflow',
  'overflowX',
  'overflowY',
  'visibility',
  'opacity',
  
  // Box Model
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderRadius',
  'borderColor',
  'borderStyle',
  'borderWidth',
  'outline',
  'outlineColor',
  'outlineStyle',
  'outlineWidth',
  'outlineOffset',
  'boxSizing',
  'boxShadow',
  
  // Typography
  'color',
  'font',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariant',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'textTransform',
  'textIndent',
  'textShadow',
  'textOverflow',
  'whiteSpace',
  'wordBreak',
  'wordSpacing',
  'wordWrap',
  
  // Background
  'background',
  'backgroundColor',
  'backgroundImage',
  'backgroundPosition',
  'backgroundSize',
  'backgroundRepeat',
  'backgroundAttachment',
  'backgroundClip',
  'backgroundOrigin',
  
  // Flexbox
  'flex',
  'flexBasis',
  'flexDirection',
  'flexFlow',
  'flexGrow',
  'flexShrink',
  'flexWrap',
  'alignContent',
  'alignItems',
  'alignSelf',
  'justifyContent',
  'justifyItems',
  'justifySelf',
  'order',
  'gap',
  'rowGap',
  'columnGap',
  
  // Grid
  'grid',
  'gridArea',
  'gridAutoColumns',
  'gridAutoFlow',
  'gridAutoRows',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnGap',
  'gridColumnStart',
  'gridGap',
  'gridRow',
  'gridRowEnd',
  'gridRowGap',
  'gridRowStart',
  'gridTemplate',
  'gridTemplateAreas',
  'gridTemplateColumns',
  'gridTemplateRows',
  
  // Transform & Animation
  'transform',
  'transformOrigin',
  'transition',
  'transitionDelay',
  'transitionDuration',
  'transitionProperty',
  'transitionTimingFunction',
  'animation',
  'animationDelay',
  'animationDirection',
  'animationDuration',
  'animationFillMode',
  'animationIterationCount',
  'animationName',
  'animationPlayState',
  'animationTimingFunction',
  
  // Other
  'cursor',
  'pointerEvents',
  'userSelect',
  'resize',
  'listStyle',
  'listStyleType',
  'listStylePosition',
  'listStyleImage',
  'verticalAlign',
  'tableLayout',
  'borderCollapse',
  'borderSpacing',
  'captionSide',
  'emptyCells',
  'objectFit',
  'objectPosition'
]);

/**
 * Blocked event handlers (these will be filtered out)
 */
export const BLOCKED_EVENT_HANDLERS = new Set([
  'onError',
  'onLoad',
  'onLoadStart',
  'onLoadEnd',
  'onProgress',
  'onAbort'
]);

/**
 * URL validation regex for href/src attributes
 */
export const SAFE_URL_PATTERN = /^(https?:\/\/|\/|#|mailto:|tel:)/i;

/**
 * Sanitize props object
 */
export function sanitizeProps(props: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(props)) {
    // Skip if not in whitelist
    if (!ALLOWED_HTML_ATTRIBUTES.has(key) && !key.startsWith('on')) {
      console.warn(`[Security] Blocked prop: ${key}`);
      continue;
    }
    
    // Handle event handlers
    if (key.startsWith('on')) {
      if (BLOCKED_EVENT_HANDLERS.has(key)) {
        console.warn(`[Security] Blocked event handler: ${key}`);
        continue;
      }
      // Event handlers should be strings (handler names) in descriptors
      if (typeof value === 'string') {
        sanitized[key] = value;
      }
      continue;
    }
    
    // Handle style prop
    if (key === 'style' && typeof value === 'object') {
      sanitized.style = sanitizeStyle(value);
      continue;
    }
    
    // Handle URLs
    if ((key === 'href' || key === 'src') && typeof value === 'string') {
      if (!SAFE_URL_PATTERN.test(value)) {
        console.warn(`[Security] Blocked unsafe URL in ${key}: ${value}`);
        continue;
      }
    }
    
    // Handle className
    if (key === 'className' && typeof value === 'string') {
      // Remove any potential script injection
      sanitized.className = value.replace(/[<>]/g, '');
      continue;
    }
    
    // Pass through other allowed props
    sanitized[key] = value;
  }
  
  return sanitized;
}

/**
 * Sanitize style object
 */
export function sanitizeStyle(style: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [prop, value] of Object.entries(style)) {
    // Convert camelCase to kebab-case for checking
    const kebabProp = prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    
    if (!ALLOWED_STYLE_PROPERTIES.has(prop) && !ALLOWED_STYLE_PROPERTIES.has(kebabProp)) {
      console.warn(`[Security] Blocked style property: ${prop}`);
      continue;
    }
    
    // Validate value doesn't contain javascript: or data: URLs
    if (typeof value === 'string') {
      if (value.includes('javascript:') || value.includes('data:')) {
        console.warn(`[Security] Blocked unsafe style value in ${prop}: ${value}`);
        continue;
      }
    }
    
    sanitized[prop] = value;
  }
  
  return sanitized;
}

/**
 * Validate a descriptor to ensure it's safe
 */
export function validateDescriptor(descriptor: any): boolean {
  if (!descriptor || typeof descriptor !== 'object') {
    return true; // Primitives are safe
  }
  
  // Check type
  if (descriptor.type && typeof descriptor.type !== 'string') {
    console.error('[Security] Invalid descriptor type');
    return false;
  }
  
  // Validate props if present
  if (descriptor.props && typeof descriptor.props === 'object') {
    // We'll sanitize props when rendering, just check structure here
    for (const [key, value] of Object.entries(descriptor.props)) {
      if (typeof key !== 'string') {
        console.error('[Security] Invalid prop key');
        return false;
      }
    }
  }
  
  // Validate children recursively
  if (descriptor.children && Array.isArray(descriptor.children)) {
    for (const child of descriptor.children) {
      if (!validateDescriptor(child)) {
        return false;
      }
    }
  }
  
  return true;
}