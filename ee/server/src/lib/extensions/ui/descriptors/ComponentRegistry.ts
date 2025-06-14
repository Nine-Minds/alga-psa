import React from 'react';

/**
 * Registry for mapping descriptor types to React components
 */
class ComponentRegistryClass {
  private components: Map<string, React.ComponentType<any>> = new Map();
  private loaders: Map<string, () => Promise<React.ComponentType<any>>> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default components
   */
  private registerDefaults() {
    // HTML elements
    this.register('div', 'div' as any);
    this.register('span', 'span' as any);
    this.register('p', 'p' as any);
    this.register('h1', 'h1' as any);
    this.register('h2', 'h2' as any);
    this.register('h3', 'h3' as any);
    this.register('h4', 'h4' as any);
    this.register('h5', 'h5' as any);
    this.register('h6', 'h6' as any);
    this.register('a', 'a' as any);
    this.register('button', 'button' as any);
    this.register('input', 'input' as any);
    this.register('textarea', 'textarea' as any);
    this.register('select', 'select' as any);
    this.register('option', 'option' as any);
    this.register('form', 'form' as any);
    this.register('label', 'label' as any);
    this.register('img', 'img' as any);
    this.register('ul', 'ul' as any);
    this.register('ol', 'ol' as any);
    this.register('li', 'li' as any);
    this.register('table', 'table' as any);
    this.register('thead', 'thead' as any);
    this.register('tbody', 'tbody' as any);
    this.register('tr', 'tr' as any);
    this.register('th', 'th' as any);
    this.register('td', 'td' as any);
    this.register('nav', 'nav' as any);
    this.register('section', 'section' as any);
    this.register('article', 'article' as any);
    this.register('header', 'header' as any);
    this.register('footer', 'footer' as any);
    this.register('main', 'main' as any);
    this.register('aside', 'aside' as any);

    // For now, we'll register UI components as simple HTML elements
    // In a real implementation, these would map to the actual UI library components
    // This avoids import issues in the EE server
    
    // Register UI components as placeholder elements
    const uiComponents = [
      'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
      'Input', 'Label', 'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
      'Textarea', 'Checkbox', 'RadioGroup', 'RadioGroupItem', 'Switch',
      'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'DialogTrigger',
      'Alert', 'AlertDescription', 'AlertTitle', 'Badge',
      'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger',
      'Table', 'TableBody', 'TableCaption', 'TableCell', 'TableHead', 'TableHeader', 'TableRow',
      'Skeleton', 'Progress', 'Separator', 'ScrollArea',
      'Sheet', 'SheetContent', 'SheetDescription', 'SheetFooter', 'SheetHeader', 'SheetTitle', 'SheetTrigger',
      'DataGrid', 'DataTable', 'LoadingSpinner', 'ErrorBoundary'
    ];

    uiComponents.forEach(name => {
      this.register(name, ((props: any) => 
        React.createElement('div', { 
          ...props, 
          'data-component': name,
          className: `ui-${name.toLowerCase()} ${props.className || ''}`
        }, props.children)
      ) as React.ComponentType<any>);
    });

    // Register icon components
    const iconComponents = [
      'Icon', 'CloudIcon', 'SettingsIcon', 'FileTextIcon', 'DollarSignIcon',
      'CheckIcon', 'XIcon', 'AlertCircleIcon', 'InfoIcon', 'WarningIcon',
      'ChevronRightIcon', 'ChevronLeftIcon', 'ChevronDownIcon', 'RefreshIcon',
      'DownloadIcon', 'UploadIcon', 'SearchIcon', 'FilterIcon', 'CalendarIcon'
    ];

    iconComponents.forEach(name => {
      this.register(name, ((props: any) => 
        React.createElement('span', { 
          ...props, 
          'data-icon': name,
          className: `icon icon-${name.toLowerCase()} ${props.className || ''}`
        }, '🔷')
      ) as React.ComponentType<any>);
    });
  }

  /**
   * Register a component
   */
  register(type: string, component: React.ComponentType<any>) {
    this.components.set(type, component);
  }

  /**
   * Register a component loader for lazy loading
   */
  registerLoader(type: string, loader: () => Promise<React.ComponentType<any>>) {
    this.loaders.set(type, loader);
    // Create a dynamic component
    const DynamicComponent = dynamic(loader, {
      loading: () => React.createElement('div', { className: 'animate-pulse' }, 'Loading...'),
      ssr: false
    });
    this.components.set(type, DynamicComponent);
  }

  /**
   * Get a component by type
   */
  get(type: string): React.ComponentType<any> | undefined {
    // Check if it's a registered component
    const component = this.components.get(type);
    if (component) return component;

    // Check aliases
    const aliases: Record<string, string> = {
      'text': 'span',
      'container': 'div',
      'box': 'div',
      'stack': 'div',
      'grid': 'div',
      'flex': 'div',
      'link': 'a',
      'image': 'img',
      'heading1': 'h1',
      'heading2': 'h2',
      'heading3': 'h3',
      'heading4': 'h4',
      'heading5': 'h5',
      'heading6': 'h6',
      'paragraph': 'p',
      'list': 'ul',
      'listItem': 'li',
      'nav-item': 'div',
      'page': 'div',
      'layout': 'div',
      'form': 'form',
      'field': 'div',
      'wizard': 'div',
      'step': 'div'
    };

    const alias = aliases[type];
    if (alias) {
      return this.components.get(alias);
    }

    console.warn(`Component type "${type}" not found in registry`);
    // Return a placeholder component
    return ((props: any) => React.createElement('div', { 
      ...props, 
      'data-component-type': type,
      style: { 
        ...props.style, 
        border: '1px dashed red', 
        padding: '8px',
        color: 'red' 
      }
    }, `[Unknown component: ${type}]`)) as React.ComponentType<any>;
  }

  /**
   * Check if a component type is registered
   */
  has(type: string): boolean {
    return this.components.has(type) || this.loaders.has(type);
  }

  /**
   * Get all registered component types
   */
  getTypes(): string[] {
    return Array.from(new Set([...this.components.keys(), ...this.loaders.keys()]));
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear() {
    this.components.clear();
    this.loaders.clear();
    this.registerDefaults();
  }
}

// Export singleton instance
export const ComponentRegistry = new ComponentRegistryClass();