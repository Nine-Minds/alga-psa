import React from 'react';
import dynamic from 'next/dynamic';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';

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
    
    // Register UI components as placeholder elements with enhanced styling
    const uiComponents = [
      // Core UI Components
      'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
      'Input', 'Label', 'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
      'Textarea', 'Checkbox', 'RadioGroup', 'RadioGroupItem', 'Switch',
      
      // Dialog Components
      'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'DialogTrigger',
      'Modal', 'ModalContent', 'ModalHeader', 'ModalBody', 'ModalFooter',
      
      // Alert & Notification Components
      'Alert', 'AlertDescription', 'AlertTitle', 'Badge', 'Toast', 'Notification',
      
      // Navigation Components
      'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger',
      'Breadcrumb', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbPage', 'BreadcrumbSeparator',
      'NavigationMenu', 'NavigationMenuItem', 'NavigationMenuLink',
      
      // Data Display Components
      'Table', 'TableBody', 'TableCaption', 'TableCell', 'TableHead', 'TableHeader', 'TableRow',
      'DataGrid', 'DataTable', 'List', 'ListItem', 'DescriptionList', 'DescriptionTerm', 'DescriptionDetails',
      
      // Layout Components
      'Container', 'Grid', 'GridItem', 'Flex', 'FlexItem', 'Stack', 'Box',
      'Skeleton', 'Progress', 'Separator', 'ScrollArea', 'Spacer',
      
      // Overlay Components
      'Sheet', 'SheetContent', 'SheetDescription', 'SheetFooter', 'SheetHeader', 'SheetTitle', 'SheetTrigger',
      'Popover', 'PopoverContent', 'PopoverTrigger', 'Tooltip', 'TooltipContent', 'TooltipTrigger',
      
      // Form Components
      'Form', 'FormField', 'FormItem', 'FormLabel', 'FormControl', 'FormDescription', 'FormMessage',
      'FieldSet', 'Legend',
      
      // Utility Components
      'LoadingSpinner', 'ErrorBoundary', 'Avatar', 'AvatarImage', 'AvatarFallback',
      'Collapsible', 'CollapsibleContent', 'CollapsibleTrigger',
      'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'
    ];

    // Enhanced component registration with better default behaviors
    uiComponents.forEach(name => {
      let element = 'div';
      let defaultProps: any = {
        'data-component': name
      };
      
      // Map certain components to more appropriate HTML elements
      if (['Button'].includes(name)) {
        element = 'button';
        defaultProps.type = 'button';
      } else if (['Input'].includes(name)) {
        element = 'input';
        defaultProps.type = 'text';
      } else if (['Textarea'].includes(name)) {
        element = 'textarea';
      } else if (['Label', 'FormLabel'].includes(name)) {
        element = 'label';
      } else if (['Select', 'SelectTrigger'].includes(name)) {
        element = 'select';
      } else if (['Table'].includes(name)) {
        element = 'table';
      } else if (['TableHead', 'TableHeader'].includes(name)) {
        element = 'thead';
      } else if (['TableBody'].includes(name)) {
        element = 'tbody';
      } else if (['TableRow'].includes(name)) {
        element = 'tr';
      } else if (['TableCell'].includes(name)) {
        element = 'td';
      } else if (['List'].includes(name)) {
        element = 'ul';
      } else if (['ListItem'].includes(name)) {
        element = 'li';
      } else if (['Form'].includes(name)) {
        element = 'form';
      } else if (['FieldSet'].includes(name)) {
        element = 'fieldset';
      } else if (['Legend'].includes(name)) {
        element = 'legend';
      } else if (['Progress'].includes(name)) {
        element = 'progress';
      } else if (['Container', 'CardContent', 'DialogContent', 'ModalContent'].includes(name)) {
        element = 'section';
      } else if (['CardHeader', 'DialogHeader', 'ModalHeader'].includes(name)) {
        element = 'header';
      } else if (['CardFooter', 'DialogFooter', 'ModalFooter'].includes(name)) {
        element = 'footer';
      } else if (name.includes('Title')) {
        element = 'h3';
      } else if (name.includes('Description')) {
        element = 'p';
      }
      
      // Generate appropriate CSS classes
      const baseClass = name
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .substring(1);
      
      this.register(name, ((props: any) => {
        const combinedProps = {
          ...defaultProps,
          ...props,
          className: `ui-${baseClass} ${props.className || ''}`
        };
        
        // Special handling for self-closing elements
        if (['input', 'img', 'br', 'hr'].includes(element)) {
          return React.createElement(element, combinedProps);
        }
        
        return React.createElement(element, combinedProps, props.children);
      }) as React.ComponentType<any>);
    });

    // Register icon components with emoji fallbacks
    const iconComponents = [
      // Core Icons
      { name: 'Icon', emoji: '📦' },
      { name: 'CloudIcon', emoji: '☁️' },
      { name: 'SettingsIcon', emoji: '⚙️' },
      { name: 'FileTextIcon', emoji: '📄' },
      { name: 'DollarSignIcon', emoji: '💲' },
      
      // Status Icons
      { name: 'CheckIcon', emoji: '✅' },
      { name: 'CheckCircleIcon', emoji: '✅' },
      { name: 'XIcon', emoji: '❌' },
      { name: 'XCircleIcon', emoji: '❌' },
      { name: 'AlertCircleIcon', emoji: '⚠️' },
      { name: 'InfoIcon', emoji: 'ℹ️' },
      { name: 'WarningIcon', emoji: '⚠️' },
      { name: 'ErrorIcon', emoji: '🚫' },
      
      // Navigation Icons
      { name: 'ChevronRightIcon', emoji: '›' },
      { name: 'ChevronLeftIcon', emoji: '‹' },
      { name: 'ChevronDownIcon', emoji: '⌄' },
      { name: 'ChevronUpIcon', emoji: '⌃' },
      { name: 'ArrowRightIcon', emoji: '→' },
      { name: 'ArrowLeftIcon', emoji: '←' },
      { name: 'ArrowUpIcon', emoji: '↑' },
      { name: 'ArrowDownIcon', emoji: '↓' },
      { name: 'MenuIcon', emoji: '☰' },
      { name: 'MoreVerticalIcon', emoji: '⋮' },
      { name: 'MoreHorizontalIcon', emoji: '⋯' },
      
      // Action Icons
      { name: 'RefreshIcon', emoji: '🔄' },
      { name: 'DownloadIcon', emoji: '⬇️' },
      { name: 'UploadIcon', emoji: '⬆️' },
      { name: 'SearchIcon', emoji: '🔍' },
      { name: 'FilterIcon', emoji: '🔽' },
      { name: 'EditIcon', emoji: '✏️' },
      { name: 'DeleteIcon', emoji: '🗑️' },
      { name: 'TrashIcon', emoji: '🗑️' },
      { name: 'SaveIcon', emoji: '💾' },
      { name: 'CopyIcon', emoji: '📋' },
      { name: 'ShareIcon', emoji: '🔗' },
      { name: 'PrintIcon', emoji: '🖨️' },
      { name: 'ExternalLinkIcon', emoji: '🔗' },
      
      // Object Icons
      { name: 'CalendarIcon', emoji: '📅' },
      { name: 'ClockIcon', emoji: '🕐' },
      { name: 'UserIcon', emoji: '👤' },
      { name: 'UsersIcon', emoji: '👥' },
      { name: 'HomeIcon', emoji: '🏠' },
      { name: 'FolderIcon', emoji: '📁' },
      { name: 'FileIcon', emoji: '📄' },
      { name: 'ImageIcon', emoji: '🖼️' },
      { name: 'VideoIcon', emoji: '🎬' },
      { name: 'MusicIcon', emoji: '🎵' },
      { name: 'MailIcon', emoji: '✉️' },
      { name: 'PhoneIcon', emoji: '📞' },
      { name: 'MapIcon', emoji: '🗺️' },
      { name: 'PinIcon', emoji: '📍' },
      { name: 'StarIcon', emoji: '⭐' },
      { name: 'HeartIcon', emoji: '❤️' },
      { name: 'LockIcon', emoji: '🔒' },
      { name: 'UnlockIcon', emoji: '🔓' },
      { name: 'KeyIcon', emoji: '🔑' },
      { name: 'BellIcon', emoji: '🔔' },
      { name: 'BookmarkIcon', emoji: '🔖' },
      { name: 'TagIcon', emoji: '🏷️' },
      { name: 'FlagIcon', emoji: '🚩' },
      { name: 'CommentIcon', emoji: '💬' },
      { name: 'ChatIcon', emoji: '💬' },
      { name: 'ShoppingCartIcon', emoji: '🛒' },
      { name: 'CreditCardIcon', emoji: '💳' },
      { name: 'GiftIcon', emoji: '🎁' },
      { name: 'TrophyIcon', emoji: '🏆' }
    ];

    iconComponents.forEach(({ name, emoji }) => {
      this.register(name, ((props: any) => 
        React.createElement('span', { 
          ...props, 
          'data-icon': name,
          className: `icon icon-${name.toLowerCase().replace('icon', '')} ${props.className || ''}`,
          'aria-hidden': 'true',
          style: {
            display: 'inline-block',
            fontSize: '1.2em',
            lineHeight: 1,
            verticalAlign: 'middle',
            ...props.style
          }
        }, emoji)
      ) as React.ComponentType<any>);
    });

    // Register real UI components for better functionality
    this.register('DataTable', DataTable);
    this.register('table', DataTable); // Also map 'table' type to DataTable
    this.register('Button', Button);
    this.register('Card', Card);
    this.register('CardContent', CardContent);
    this.register('CardHeader', CardHeader);
    this.register('CardTitle', CardTitle);
    this.register('CardDescription', CardDescription);
    this.register('CardFooter', CardFooter);
    this.register('Badge', Badge);
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