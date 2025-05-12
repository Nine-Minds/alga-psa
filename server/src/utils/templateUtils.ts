export const processTemplateVariables = (value: any, contextData: Record<string, any> | undefined | null): any => {
  const originalValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  console.log(`[processTemplateVariables] Input value: ${originalValue}, contextData:`, contextData ? JSON.stringify(contextData) : contextData);

  if (typeof value !== 'string') {
    // Handle non-string types (recursion for objects/arrays)
    if (Array.isArray(value)) {
      const processedArray = value.map(item => processTemplateVariables(item, contextData));
      console.log(`[processTemplateVariables] Processed array. Original: ${originalValue}, Result: ${JSON.stringify(processedArray)}`);
      return processedArray;
    }
    if (typeof value === 'object' && value !== null) {
      const processedObject: Record<string, any> = {};
      for (const objKey in value) {
        if (Object.prototype.hasOwnProperty.call(value, objKey)) {
          processedObject[objKey] = processTemplateVariables(value[objKey], contextData);
        }
      }
      console.log(`[processTemplateVariables] Processed object. Original: ${originalValue}, Result: ${JSON.stringify(processedObject)}`);
      return processedObject;
    }
    // Return non-string, non-object/array values as is
    console.log(`[processTemplateVariables] Value is not string/array/object, returning as is: ${originalValue}`);
    return value;
  }

  // Process string value
  let processedString = value;

  if (contextData && typeof contextData === 'object' && Object.keys(contextData).length > 0) {
    // Regex to find all placeholders like ${contextData.key} or ${key}
    const placeholderRegex = /\$\{contextData\.([^}]+)\}|\$\{([^}]+)\}/g;

    processedString = processedString.replace(placeholderRegex, (match, contextKey, directKey) => {
      const keyToLookup = contextKey || directKey;
      if (keyToLookup && Object.prototype.hasOwnProperty.call(contextData, keyToLookup)) {
        // Key found in contextData, return the replacement value
        const replacement = String(contextData[keyToLookup] ?? '');
        console.log(`[processTemplateVariables] Replacing '${match}' with '${replacement}' (key: ${keyToLookup})`);
        return replacement;
      }
      // Key not found in contextData, return the original placeholder
      console.log(`[processTemplateVariables] Key '${keyToLookup}' not found in contextData for placeholder '${match}'. Keeping placeholder.`);
      return match;
    });
  } else {
    console.log('[processTemplateVariables] contextData is invalid or empty. No replacements performed on string.');
  }
  
  console.log(`[processTemplateVariables] Processed string. Original: "${value}", Result: "${processedString}"`);
  return processedString;
};
