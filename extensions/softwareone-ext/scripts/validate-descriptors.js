#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// Validation rules
const descriptorSchema = {
  type: { required: true, type: 'string' },
  props: { required: false, type: 'object' },
  children: { required: false, type: 'array' },
  handlers: { required: false, type: 'object' },
  condition: { required: false, type: 'object' },
  permissions: { required: false, type: 'array' },
  style: { required: false, type: 'object' }
};

const pageDescriptorSchema = {
  ...descriptorSchema,
  type: { required: true, type: 'string', value: 'page' },
  meta: { required: false, type: 'object' },
  content: { required: true, type: 'object' },
  data: { required: false, type: 'array' },
  handlers: { 
    required: false, 
    type: 'object',
    properties: {
      module: { required: true, type: 'string' }
    }
  }
};

function validateDescriptor(descriptor, schema = descriptorSchema, path = '') {
  const errors = [];

  // Check required fields
  for (const [key, rules] of Object.entries(schema)) {
    if (rules.required && !(key in descriptor)) {
      errors.push(`${path}: Missing required field "${key}"`);
    } else if (key in descriptor) {
      // Type checking
      const actualType = Array.isArray(descriptor[key]) ? 'array' : typeof descriptor[key];
      if (rules.type && actualType !== rules.type) {
        errors.push(`${path}.${key}: Expected type "${rules.type}" but got "${actualType}"`);
      }
      // Value checking
      if (rules.value && descriptor[key] !== rules.value) {
        errors.push(`${path}.${key}: Expected value "${rules.value}" but got "${descriptor[key]}"`);
      }
      // Nested validation
      if (rules.properties && typeof descriptor[key] === 'object') {
        errors.push(...validateDescriptor(descriptor[key], rules.properties, `${path}.${key}`));
      }
    }
  }

  // Recursively validate children
  if (descriptor.children && Array.isArray(descriptor.children)) {
    descriptor.children.forEach((child, index) => {
      if (typeof child === 'object' && child !== null) {
        errors.push(...validateDescriptor(child, descriptorSchema, `${path}.children[${index}]`));
      }
    });
  }

  // Validate handlers
  if (descriptor.handlers) {
    for (const [event, handler] of Object.entries(descriptor.handlers)) {
      if (typeof handler !== 'string' && typeof handler !== 'object') {
        errors.push(`${path}.handlers.${event}: Handler must be a string or object`);
      }
      if (typeof handler === 'object' && !handler.handler) {
        errors.push(`${path}.handlers.${event}: Handler object must have a "handler" property`);
      }
    }
  }

  return errors;
}

function checkHandlerReferences(descriptor, handlerModule, availableHandlers = new Set()) {
  const missingHandlers = [];
  
  function checkHandlers(desc, path = '') {
    if (desc.handlers && typeof desc.handlers === 'object') {
      for (const [event, handler] of Object.entries(desc.handlers)) {
        // Skip the 'module' property - it's not a handler
        if (event === 'module') continue;
        
        const handlerName = typeof handler === 'string' ? handler : handler.handler;
        if (handlerName && !availableHandlers.has(handlerName)) {
          missingHandlers.push({
            handler: handlerName,
            location: `${path}.handlers.${event}`,
            module: handlerModule
          });
        }
      }
    }
    
    if (desc.children && Array.isArray(desc.children)) {
      desc.children.forEach((child, index) => {
        if (typeof child === 'object' && child !== null) {
          checkHandlers(child, `${path}.children[${index}]`);
        }
      });
    }
  }
  
  checkHandlers(descriptor);
  return missingHandlers;
}

async function loadHandlerModule(modulePath) {
  // Try with .ts extension first, then .js
  const tsPath = path.join(process.cwd(), 'src', 'descriptors', modulePath + '.ts');
  const jsPath = path.join(process.cwd(), 'src', 'descriptors', modulePath + '.js');
  
  let fullPath = null;
  if (fs.existsSync(tsPath)) {
    fullPath = tsPath;
  } else if (fs.existsSync(jsPath)) {
    fullPath = jsPath;
  } else {
    return null;
  }
  
  try {
    // Read the file and extract exported function names
    const content = fs.readFileSync(fullPath, 'utf-8');
    const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
    const handlers = new Set();
    
    for (const match of exportMatches) {
      handlers.add(match[1]);
    }
    
    return handlers;
  } catch (error) {
    console.error(`Error reading handler module ${modulePath}:`, error.message);
    return new Set();
  }
}

async function validateDescriptorFile(filePath) {
  console.log(`\n${colors.blue}Validating: ${colors.reset}${filePath}`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const descriptor = JSON.parse(content);
    
    // Determine schema based on type
    const schema = descriptor.type === 'page' ? pageDescriptorSchema : descriptorSchema;
    
    // Structural validation
    const errors = validateDescriptor(descriptor, schema);
    
    // Handler validation
    let handlerErrors = [];
    if (descriptor.handlers?.module) {
      const handlers = await loadHandlerModule(descriptor.handlers.module);
      if (handlers) {
        const missing = checkHandlerReferences(descriptor, descriptor.handlers.module, handlers);
        handlerErrors = missing.map(m => 
          `Missing handler "${m.handler}" referenced at ${m.location} (expected in ${m.module})`
        );
      } else {
        errors.push(`Handler module not found: ${descriptor.handlers.module}`);
      }
    } else if (!descriptor.handlers?.module && descriptor.type !== 'nav-item') {
      // For pages without handler modules, we skip handler validation
      // since handlers might be inline or provided by the parent
    }
    
    const allErrors = [...errors, ...handlerErrors];
    
    if (allErrors.length === 0) {
      console.log(`${colors.green}✓ Valid${colors.reset}`);
      return { file: filePath, valid: true, errors: [] };
    } else {
      console.log(`${colors.red}✗ Invalid${colors.reset}`);
      allErrors.forEach(error => {
        console.log(`  ${colors.red}•${colors.reset} ${error}`);
      });
      return { file: filePath, valid: false, errors: allErrors };
    }
  } catch (error) {
    console.log(`${colors.red}✗ Error: ${error.message}${colors.reset}`);
    return { file: filePath, valid: false, errors: [error.message] };
  }
}

async function main() {
  console.log(`${colors.blue}SoftwareOne Extension Descriptor Validator${colors.reset}`);
  console.log(`${colors.gray}${'='.repeat(50)}${colors.reset}`);
  
  // Find all descriptor files
  const descriptorFiles = glob.sync('src/descriptors/**/*.json');
  
  if (descriptorFiles.length === 0) {
    console.log(`${colors.yellow}No descriptor files found in src/descriptors/**/*.json${colors.reset}`);
    process.exit(0);
  }
  
  console.log(`Found ${descriptorFiles.length} descriptor files`);
  
  // Validate each file
  const results = [];
  for (const file of descriptorFiles) {
    const result = await validateDescriptorFile(file);
    results.push(result);
  }
  
  // Summary
  console.log(`\n${colors.blue}Summary:${colors.reset}`);
  console.log(`${colors.gray}${'='.repeat(50)}${colors.reset}`);
  
  const validCount = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;
  
  console.log(`Total files: ${results.length}`);
  console.log(`${colors.green}Valid: ${validCount}${colors.reset}`);
  console.log(`${colors.red}Invalid: ${invalidCount}${colors.reset}`);
  
  // Exit with error code if any validation failed
  if (invalidCount > 0) {
    console.log(`\n${colors.red}Validation failed!${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}All descriptors are valid!${colors.reset}`);
    process.exit(0);
  }
}

// Run validation
main().catch(error => {
  console.error(`${colors.red}Unexpected error: ${error.message}${colors.reset}`);
  process.exit(1);
});