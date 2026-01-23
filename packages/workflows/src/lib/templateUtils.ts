/**
 * Utility functions for working with workflow templates
 */

/**
 * Extract code from a template definition
 * 
 * @param definition Template definition object
 * @returns Extracted code or placeholder message
 */
export function extractTemplateCode(definition: any): string {
  try {
    // 1. Check if the definition itself is the code string
    if (typeof definition === 'string') {
       // Basic check to avoid returning simple strings like "object" or JSON
       if (!definition.startsWith('{') && !definition.startsWith('[')) {
           return definition;
       }
       // If it looks like JSON, fall through to parsing logic below
    }

    // 2. Check if definition is an object
    if (definition && typeof definition === 'object') {
      // 2a. Prefer the new 'code' property if it exists
      if (definition.code && typeof definition.code === 'string') {
        return definition.code;
      }
      // 2b. Fallback to 'executeFn' for backward compatibility
      if (definition.executeFn && typeof definition.executeFn === 'string') {
        return definition.executeFn;
      }
    }

    // 3. If definition was a string but looked like JSON, try parsing
    if (typeof definition === 'string') {
      try {
        const parsed = JSON.parse(definition);
        // Check parsed object for code or executeFn
        if (parsed.code && typeof parsed.code === 'string') {
          return parsed.code;
        }
        if (parsed.executeFn && typeof parsed.executeFn === 'string') {
          return parsed.executeFn;
        }
      } catch (e) {
        // Not a valid JSON string containing code/executeFn, return original string if it wasn't just "[object Object]" etc.
        if (definition !== '[object Object]') {
            return definition; // Return the original string if parsing failed but it wasn't a generic object string
        }
      }
    }

    // 4. If no code found, return placeholder
    return "// No code available for this template";
  } catch (error) {
    console.error("Error extracting template code:", error);
    return "// Error extracting template code";
  }
}

/**
 * Format parameter schema for display
 * 
 * @param schema Parameter schema object
 * @returns Formatted schema as string
 */
export function formatParameterSchema(schema: any): string {
  try {
    if (!schema) return "// No parameters required";
    
    if (typeof schema === 'string') {
      try {
        schema = JSON.parse(schema);
      } catch (e) {
        return schema;
      }
    }
    
    return JSON.stringify(schema, null, 2);
  } catch (error) {
    console.error("Error formatting parameter schema:", error);
    return "// Error formatting parameter schema";
  }
}