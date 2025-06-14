import React from 'react';
import dynamic from 'next/dynamic';

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

    // Register async loaders for UI components
    this.registerLoader('Button', () => import('@/components/ui/button').then(m => m.Button));
    this.registerLoader('Card', () => import('@/components/ui/card').then(m => m.Card));
    this.registerLoader('CardHeader', () => import('@/components/ui/card').then(m => m.CardHeader));
    this.registerLoader('CardTitle', () => import('@/components/ui/card').then(m => m.CardTitle));
    this.registerLoader('CardDescription', () => import('@/components/ui/card').then(m => m.CardDescription));
    this.registerLoader('CardContent', () => import('@/components/ui/card').then(m => m.CardContent));
    this.registerLoader('CardFooter', () => import('@/components/ui/card').then(m => m.CardFooter));
    this.registerLoader('Input', () => import('@/components/ui/input').then(m => m.Input));
    this.registerLoader('Label', () => import('@/components/ui/label').then(m => m.Label));
    this.registerLoader('Select', () => import('@/components/ui/select').then(m => m.Select));
    this.registerLoader('SelectContent', () => import('@/components/ui/select').then(m => m.SelectContent));
    this.registerLoader('SelectItem', () => import('@/components/ui/select').then(m => m.SelectItem));
    this.registerLoader('SelectTrigger', () => import('@/components/ui/select').then(m => m.SelectTrigger));
    this.registerLoader('SelectValue', () => import('@/components/ui/select').then(m => m.SelectValue));
    this.registerLoader('Textarea', () => import('@/components/ui/textarea').then(m => m.Textarea));
    this.registerLoader('Checkbox', () => import('@/components/ui/checkbox').then(m => m.Checkbox));
    this.registerLoader('RadioGroup', () => import('@/components/ui/radio-group').then(m => m.RadioGroup));
    this.registerLoader('RadioGroupItem', () => import('@/components/ui/radio-group').then(m => m.RadioGroupItem));
    this.registerLoader('Switch', () => import('@/components/ui/switch').then(m => m.Switch));
    this.registerLoader('Dialog', () => import('@/components/ui/dialog').then(m => m.Dialog));
    this.registerLoader('DialogContent', () => import('@/components/ui/dialog').then(m => m.DialogContent));
    this.registerLoader('DialogDescription', () => import('@/components/ui/dialog').then(m => m.DialogDescription));
    this.registerLoader('DialogFooter', () => import('@/components/ui/dialog').then(m => m.DialogFooter));
    this.registerLoader('DialogHeader', () => import('@/components/ui/dialog').then(m => m.DialogHeader));
    this.registerLoader('DialogTitle', () => import('@/components/ui/dialog').then(m => m.DialogTitle));
    this.registerLoader('DialogTrigger', () => import('@/components/ui/dialog').then(m => m.DialogTrigger));
    this.registerLoader('Alert', () => import('@/components/ui/alert').then(m => m.Alert));
    this.registerLoader('AlertDescription', () => import('@/components/ui/alert').then(m => m.AlertDescription));
    this.registerLoader('AlertTitle', () => import('@/components/ui/alert').then(m => m.AlertTitle));
    this.registerLoader('Badge', () => import('@/components/ui/badge').then(m => m.Badge));
    this.registerLoader('Tabs', () => import('@/components/ui/tabs').then(m => m.Tabs));
    this.registerLoader('TabsContent', () => import('@/components/ui/tabs').then(m => m.TabsContent));
    this.registerLoader('TabsList', () => import('@/components/ui/tabs').then(m => m.TabsList));
    this.registerLoader('TabsTrigger', () => import('@/components/ui/tabs').then(m => m.TabsTrigger));
    this.registerLoader('Table', () => import('@/components/ui/table').then(m => m.Table));
    this.registerLoader('TableBody', () => import('@/components/ui/table').then(m => m.TableBody));
    this.registerLoader('TableCaption', () => import('@/components/ui/table').then(m => m.TableCaption));
    this.registerLoader('TableCell', () => import('@/components/ui/table').then(m => m.TableCell));
    this.registerLoader('TableHead', () => import('@/components/ui/table').then(m => m.TableHead));
    this.registerLoader('TableHeader', () => import('@/components/ui/table').then(m => m.TableHeader));
    this.registerLoader('TableRow', () => import('@/components/ui/table').then(m => m.TableRow));
    this.registerLoader('Skeleton', () => import('@/components/ui/skeleton').then(m => m.Skeleton));
    this.registerLoader('Progress', () => import('@/components/ui/progress').then(m => m.Progress));
    this.registerLoader('Separator', () => import('@/components/ui/separator').then(m => m.Separator));
    this.registerLoader('ScrollArea', () => import('@/components/ui/scroll-area').then(m => m.ScrollArea));
    this.registerLoader('Sheet', () => import('@/components/ui/sheet').then(m => m.Sheet));
    this.registerLoader('SheetContent', () => import('@/components/ui/sheet').then(m => m.SheetContent));
    this.registerLoader('SheetDescription', () => import('@/components/ui/sheet').then(m => m.SheetDescription));
    this.registerLoader('SheetFooter', () => import('@/components/ui/sheet').then(m => m.SheetFooter));
    this.registerLoader('SheetHeader', () => import('@/components/ui/sheet').then(m => m.SheetHeader));
    this.registerLoader('SheetTitle', () => import('@/components/ui/sheet').then(m => m.SheetTitle));
    this.registerLoader('SheetTrigger', () => import('@/components/ui/sheet').then(m => m.SheetTrigger));

    // Register custom components
    this.registerLoader('DataGrid', () => import('@/components/ui/data-grid').then(m => m.DataGrid || m.default));
    this.registerLoader('DataTable', () => import('@/components/ui/data-table').then(m => m.DataTable || m.default));
    this.registerLoader('LoadingSpinner', () => import('@/components/ui/loading-spinner').then(m => m.LoadingSpinner || m.default));
    this.registerLoader('ErrorBoundary', () => import('@/components/ui/error-boundary').then(m => m.ErrorBoundary || m.default));

    // Icons (using lucide-react)
    this.registerLoader('Icon', () => import('@/components/ui/icon').then(m => m.Icon || m.default));
    this.registerLoader('CloudIcon', () => import('lucide-react').then(m => m.Cloud));
    this.registerLoader('SettingsIcon', () => import('lucide-react').then(m => m.Settings));
    this.registerLoader('FileTextIcon', () => import('lucide-react').then(m => m.FileText));
    this.registerLoader('DollarSignIcon', () => import('lucide-react').then(m => m.DollarSign));
    this.registerLoader('CheckIcon', () => import('lucide-react').then(m => m.Check));
    this.registerLoader('XIcon', () => import('lucide-react').then(m => m.X));
    this.registerLoader('AlertCircleIcon', () => import('lucide-react').then(m => m.AlertCircle));
    this.registerLoader('InfoIcon', () => import('lucide-react').then(m => m.Info));
    this.registerLoader('WarningIcon', () => import('lucide-react').then(m => m.AlertTriangle));
    this.registerLoader('ChevronRightIcon', () => import('lucide-react').then(m => m.ChevronRight));
    this.registerLoader('ChevronDownIcon', () => import('lucide-react').then(m => m.ChevronDown));
    this.registerLoader('RefreshIcon', () => import('lucide-react').then(m => m.RefreshCw));
    this.registerLoader('DownloadIcon', () => import('lucide-react').then(m => m.Download));
    this.registerLoader('UploadIcon', () => import('lucide-react').then(m => m.Upload));
    this.registerLoader('SearchIcon', () => import('lucide-react').then(m => m.Search));
    this.registerLoader('FilterIcon', () => import('lucide-react').then(m => m.Filter));
    this.registerLoader('CalendarIcon', () => import('lucide-react').then(m => m.Calendar));
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