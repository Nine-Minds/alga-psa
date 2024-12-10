// src/utils/inputResolver.ts

export function resolveInputField(input: any, fieldPath: string): any {
    if (!fieldPath.startsWith('$.')) {
      return fieldPath; // Direct input
    }
  
    const path = fieldPath.slice(2).split('.');
    let value = input;
  
    for (const key of path) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[key];
    }
  
    return value;
  }
  