import { UIDescriptor, PageDescriptor, ValidationResult, ValidationError } from './types';
import { validateDescriptor } from './validation';

/**
 * Loads and validates descriptors from extension files
 */
export class DescriptorLoader {
  private cache: Map<string, UIDescriptor | PageDescriptor> = new Map();
  private validationCache: Map<string, ValidationResult> = new Map();

  /**
   * Load a descriptor from a URL
   */
  async load(url: string): Promise<UIDescriptor | PageDescriptor> {
    // Check cache
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load descriptor: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      let descriptor: any;

      if (contentType?.includes('application/json')) {
        descriptor = await response.json();
      } else if (contentType?.includes('javascript')) {
        // Handle JS modules that export descriptors
        const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
        descriptor = module.default || module.descriptor;
      } else {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      // Validate descriptor
      const validation = await this.validate(descriptor);
      if (!validation.valid) {
        throw new Error(`Invalid descriptor: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Cache the descriptor
      this.cache.set(url, descriptor);
      this.validationCache.set(url, validation);

      return descriptor;
    } catch (error) {
      console.error(`Failed to load descriptor from ${url}:`, error);
      throw error;
    }
  }

  /**
   * Load a descriptor from JSON string
   */
  async loadFromJson(json: string): Promise<UIDescriptor | PageDescriptor> {
    try {
      const descriptor = JSON.parse(json);
      const validation = await this.validate(descriptor);
      
      if (!validation.valid) {
        throw new Error(`Invalid descriptor: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      return descriptor;
    } catch (error) {
      console.error('Failed to parse descriptor JSON:', error);
      throw error;
    }
  }

  /**
   * Validate a descriptor
   */
  async validate(descriptor: any): Promise<ValidationResult> {
    return validateDescriptor(descriptor);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.validationCache.clear();
  }

  /**
   * Get cached descriptor
   */
  getCached(url: string): UIDescriptor | PageDescriptor | undefined {
    return this.cache.get(url);
  }

  /**
   * Get validation result for a cached descriptor
   */
  getValidation(url: string): ValidationResult | undefined {
    return this.validationCache.get(url);
  }

  /**
   * Preload multiple descriptors
   */
  async preload(urls: string[]): Promise<void> {
    await Promise.all(urls.map(url => this.load(url).catch(err => {
      console.error(`Failed to preload ${url}:`, err);
    })));
  }

  /**
   * Transform descriptor (apply preprocessing)
   */
  transform(descriptor: UIDescriptor | PageDescriptor, transformers: DescriptorTransformer[]): UIDescriptor | PageDescriptor {
    let result = descriptor;
    for (const transformer of transformers) {
      result = transformer(result);
    }
    return result;
  }
}

/**
 * Descriptor transformer function
 */
export type DescriptorTransformer = (descriptor: UIDescriptor | PageDescriptor) => UIDescriptor | PageDescriptor;

/**
 * Built-in transformers
 */
export const Transformers = {
  /**
   * Add default props to all descriptors of a certain type
   */
  addDefaultProps: (type: string, props: Record<string, any>): DescriptorTransformer => {
    return (descriptor) => {
      const transform = (desc: any): any => {
        if (desc.type === type) {
          return {
            ...desc,
            props: {
              ...props,
              ...desc.props
            }
          };
        }
        if (desc.children) {
          return {
            ...desc,
            children: desc.children.map((child: any) => 
              typeof child === 'object' ? transform(child) : child
            )
          };
        }
        return desc;
      };
      return transform(descriptor);
    };
  },

  /**
   * Add className to all descriptors
   */
  addClassName: (className: string): DescriptorTransformer => {
    return (descriptor) => {
      const transform = (desc: any): any => {
        if (typeof desc !== 'object' || !desc.type) return desc;
        
        const existingClassName = desc.style?.className || '';
        const newClassName = existingClassName ? `${existingClassName} ${className}` : className;
        
        const result = {
          ...desc,
          style: {
            ...desc.style,
            className: newClassName
          }
        };
        
        if (desc.children) {
          result.children = desc.children.map((child: any) => 
            typeof child === 'object' ? transform(child) : child
          );
        }
        
        return result;
      };
      return transform(descriptor);
    };
  },

  /**
   * Replace component types
   */
  replaceType: (oldType: string, newType: string): DescriptorTransformer => {
    return (descriptor) => {
      const transform = (desc: any): any => {
        if (desc.type === oldType) {
          return { ...desc, type: newType };
        }
        if (desc.children) {
          return {
            ...desc,
            children: desc.children.map((child: any) => 
              typeof child === 'object' ? transform(child) : child
            )
          };
        }
        return desc;
      };
      return transform(descriptor);
    };
  },

  /**
   * Apply theme
   */
  applyTheme: (theme: 'light' | 'dark'): DescriptorTransformer => {
    return (descriptor) => {
      const themeClass = theme === 'dark' ? 'dark' : '';
      return Transformers.addClassName(themeClass)(descriptor);
    };
  }
};

/**
 * Create a singleton instance
 */
export const descriptorLoader = new DescriptorLoader();