/**
 * Core type definitions for the Alga PSA Extension Descriptor System
 */

/**
 * Base descriptor interface that all UI descriptors must implement
 */
export interface BaseDescriptor {
  /** Unique identifier for this descriptor instance */
  id?: string;
  /** Type of component/element to render */
  type: string;
  /** Properties to pass to the component */
  props?: Record<string, any>;
  /** Child descriptors or primitive values */
  children?: (Descriptor | string | number)[];
  /** Event handlers mapping */
  handlers?: Record<string, string>;
}

/**
 * Descriptor can be a complex object or a primitive value
 */
export type Descriptor = BaseDescriptor | string | number;

/**
 * Component descriptor with render function
 */
export interface ComponentDescriptor extends BaseDescriptor {
  /** Render function that returns element structure */
  render?: (props: any, context: ExtensionContext) => ElementDescriptor;
  /** Handler functions for events */
  handlerFunctions?: Record<string, HandlerFunction>;
}

/**
 * Element descriptor for rendering
 */
export interface ElementDescriptor {
  /** HTML element type or component name */
  element: string;
  /** Properties/attributes for the element */
  props?: Record<string, any>;
  /** Event handlers */
  handlers?: Record<string, string>;
  /** Child elements */
  children?: (ElementDescriptor | string | number)[];
}

/**
 * Handler function signature
 */
export type HandlerFunction = (
  event: Event,
  props: Record<string, any>,
  context: ExtensionContext
) => void | Promise<void>;

/**
 * Extension context provided to all descriptors
 */
export interface ExtensionContext {
  /** Navigation service */
  navigation: NavigationService;
  /** API service for making requests */
  api: ApiService;
  /** Storage service for persisting data */
  storage: StorageService;
  /** UI utilities */
  ui: UIService;
  /** Current tenant ID */
  tenantId: string;
  /** Current user information */
  user: UserInfo;
}

/**
 * Navigation service interface
 */
export interface NavigationService {
  /** Navigate to a route */
  navigate(path: string): void;
  /** Get current route */
  getCurrentRoute(): string;
  /** Add navigation listener */
  onNavigate(callback: (path: string) => void): () => void;
}

/**
 * API service interface
 */
export interface ApiService {
  /** Make GET request */
  get<T = any>(path: string, options?: RequestOptions): Promise<T>;
  /** Make POST request */
  post<T = any>(path: string, data?: any, options?: RequestOptions): Promise<T>;
  /** Make PUT request */
  put<T = any>(path: string, data?: any, options?: RequestOptions): Promise<T>;
  /** Make DELETE request */
  delete<T = any>(path: string, options?: RequestOptions): Promise<T>;
}

/**
 * Storage service interface
 */
export interface StorageService {
  /** Get value from storage */
  get<T = any>(key: string): Promise<T | null>;
  /** Set value in storage */
  set<T = any>(key: string, value: T): Promise<void>;
  /** Remove value from storage */
  remove(key: string): Promise<void>;
  /** Clear all storage for this extension */
  clear(): Promise<void>;
}

/**
 * UI service interface
 */
export interface UIService {
  /** Show toast notification */
  toast(message: string, type?: 'success' | 'error' | 'info' | 'warning'): void;
  /** Show confirmation dialog */
  confirm(message: string, title?: string): Promise<boolean>;
  /** Show modal dialog */
  modal(content: Descriptor, options?: ModalOptions): Promise<void>;
}

/**
 * User information
 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Modal options
 */
export interface ModalOptions {
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnOverlayClick?: boolean;
}

/**
 * Security whitelist for allowed props
 */
export const ALLOWED_PROPS = new Set([
  'className',
  'style',
  'id',
  'title',
  'aria-label',
  'aria-hidden',
  'aria-expanded',
  'aria-controls',
  'aria-describedby',
  'role',
  'tabIndex',
  'data-testid',
  'href',
  'target',
  'rel',
  'type',
  'disabled',
  'checked',
  'value',
  'placeholder',
  'name',
  'min',
  'max',
  'step',
  'pattern',
  'required',
  'readonly',
  'multiple',
  'accept',
  'autoComplete',
  'autoFocus',
  'rows',
  'cols',
  'wrap',
  'size',
  'alt',
  'src',
  'width',
  'height',
  'loading',
  'for',
  'colspan',
  'rowspan',
  'scope',
  'headers'
]);

/**
 * Allowed HTML elements
 */
export const ALLOWED_ELEMENTS = new Set([
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'label',
  'form',
  'fieldset',
  'legend',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'img',
  'figure',
  'figcaption',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'iframe',
  'embed',
  'object',
  'param',
  'blockquote',
  'cite',
  'q',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'mark',
  'ins',
  'del',
  'sub',
  'sup',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'abbr',
  'address',
  'time',
  'details',
  'summary',
  'dialog',
  'menu',
  'menuitem',
  'nav',
  'header',
  'footer',
  'main',
  'section',
  'article',
  'aside',
  'hr',
  'br',
  'wbr',
  'meter',
  'progress',
  'ruby',
  'rt',
  'rp',
  'bdi',
  'bdo',
  'canvas',
  'noscript',
  'script',
  'template',
  'slot'
]);

/**
 * Type guard to check if a descriptor is a BaseDescriptor
 */
export function isBaseDescriptor(desc: Descriptor): desc is BaseDescriptor {
  return typeof desc === 'object' && desc !== null && 'type' in desc;
}

/**
 * Type guard to check if a value is a primitive descriptor
 */
export function isPrimitiveDescriptor(desc: any): desc is string | number {
  return typeof desc === 'string' || typeof desc === 'number';
}