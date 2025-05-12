export const processTemplateVariables = (value: any, contextData: Record<string, any> | undefined | null): any => {
console.log('[processTemplateVariables] Input value:', value);
  console.log('[processTemplateVariables] Input contextData:', contextData);
  if (!contextData || typeof contextData !== 'object') {
    // If contextData is not a valid object, return the original value
    // or handle as an error, depending on desired behavior.
    // For now, returning original value to prevent crashes if contextData is missing.
    if (typeof value === 'string') {
        // Still attempt to replace contextData.X if it's literally in the string
        // but there's no contextData object to provide values.
        // This might leave unresolved ${contextData.key} if contextData is null/undefined.
        // Consider if this is the desired behavior or if it should throw an error
        // or return the string as is without attempting replacement.
        let processedString = value;
        // Regex to match ${contextData.anything} or ${anything}
        const placeholderRegex = /\$\{contextData\.([^}]+)\}|\$\{([^}]+)\}/g;
        processedString = processedString.replace(placeholderRegex, (match, contextKey, directKey) => {
            const keyToLookup = contextKey || directKey;
            // Since contextData is not valid here, we can't look up the key.
            // Return the original placeholder or an empty string.
            // Returning original placeholder to make it clear it wasn't resolved.
            return match;
        });
        return processedString;
    }
    return value;
  }

  if (typeof value === 'string') {
    let processedString = value;
    Object.keys(contextData).forEach(key => {
      // Escape special characters in the key for regex
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const placeholder1 = new RegExp(`\\$\\{contextData\\.${escapedKey}\\}`, 'g');
      const placeholder2 = new RegExp(`\\$\\{${escapedKey}\\}`, 'g');
      const replacementValue = String(contextData[key] ?? '');

      processedString = processedString.replace(placeholder1, replacementValue);
      processedString = processedString.replace(placeholder2, replacementValue);
    });
    // A second pass for any generic ${contextData.foo.bar} or ${foo.bar} where foo.bar might not be a direct key
    // This is more complex and might require a more sophisticated parsing if nested properties in strings are common.
    // The current Object.keys(contextData) approach only handles direct keys.
    // For simplicity, we'll stick to direct key replacement as per the original ButtonLinkWidget logic.
console.log('[processTemplateVariables] Processed string:', processedString);
    return processedString;
  }

  if (Array.isArray(value)) {
    return value.map(item => processTemplateVariables(item, contextData));
  }

  if (typeof value === 'object' && value !== null) {
    const processedObject: Record<string, any> = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        processedObject[key] = processTemplateVariables(value[key], contextData);
      }
    }
console.log('[processTemplateVariables] Processed object:', processedObject);
    return processedObject;
  }

  return value;
};