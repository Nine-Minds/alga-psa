/**
 * Built-in JSONata Function Definitions
 *
 * Provides metadata for autocomplete, signature help, and hover information
 * for all available functions in workflow expressions.
 */

export interface FunctionParameter {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

export interface FunctionDefinition {
  name: string;
  signature: string;
  description: string;
  parameters: FunctionParameter[];
  returnType: string;
  category: 'String' | 'Number' | 'Array' | 'Object' | 'Boolean' | 'Date' | 'Higher-Order' | 'Misc';
  examples?: string[];
}

/**
 * All built-in JSONata functions available in workflow expressions
 */
export const builtinFunctions: FunctionDefinition[] = [
  // String functions
  {
    name: '$string',
    signature: '$string(value)',
    description: 'Converts a value to a string',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to convert' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$string(123) → "123"', '$string(true) → "true"'],
  },
  {
    name: '$length',
    signature: '$length(str)',
    description: 'Returns the length of a string',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to measure' },
    ],
    returnType: 'number',
    category: 'String',
    examples: ['$length("hello") → 5'],
  },
  {
    name: '$substring',
    signature: '$substring(str, start, length?)',
    description: 'Returns a substring starting at the specified position',
    parameters: [
      { name: 'str', type: 'string', description: 'The source string' },
      { name: 'start', type: 'number', description: 'Starting position (0-based)' },
      { name: 'length', type: 'number', description: 'Number of characters to extract', optional: true },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$substring("hello", 0, 2) → "he"', '$substring("hello", 2) → "llo"'],
  },
  {
    name: '$substringBefore',
    signature: '$substringBefore(str, chars)',
    description: 'Returns the substring before the first occurrence of chars',
    parameters: [
      { name: 'str', type: 'string', description: 'The source string' },
      { name: 'chars', type: 'string', description: 'The delimiter to search for' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$substringBefore("hello@world", "@") → "hello"'],
  },
  {
    name: '$substringAfter',
    signature: '$substringAfter(str, chars)',
    description: 'Returns the substring after the first occurrence of chars',
    parameters: [
      { name: 'str', type: 'string', description: 'The source string' },
      { name: 'chars', type: 'string', description: 'The delimiter to search for' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$substringAfter("hello@world", "@") → "world"'],
  },
  {
    name: '$uppercase',
    signature: '$uppercase(str)',
    description: 'Converts a string to uppercase',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to convert' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$uppercase("hello") → "HELLO"'],
  },
  {
    name: '$lowercase',
    signature: '$lowercase(str)',
    description: 'Converts a string to lowercase',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to convert' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$lowercase("HELLO") → "hello"'],
  },
  {
    name: '$trim',
    signature: '$trim(str)',
    description: 'Removes leading and trailing whitespace',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to trim' },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$trim("  hello  ") → "hello"'],
  },
  {
    name: '$pad',
    signature: '$pad(str, width, char?)',
    description: 'Pads a string to the specified width',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to pad' },
      { name: 'width', type: 'number', description: 'Target width (negative for left pad)' },
      { name: 'char', type: 'string', description: 'Padding character (default: space)', optional: true },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$pad("1", 3, "0") → "100"', '$pad("1", -3, "0") → "001"'],
  },
  {
    name: '$contains',
    signature: '$contains(str, pattern)',
    description: 'Returns true if string contains the pattern',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to search in' },
      { name: 'pattern', type: 'string | regex', description: 'The pattern to find' },
    ],
    returnType: 'boolean',
    category: 'String',
    examples: ['$contains("hello world", "world") → true'],
  },
  {
    name: '$split',
    signature: '$split(str, separator, limit?)',
    description: 'Splits a string into an array of substrings',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to split' },
      { name: 'separator', type: 'string | regex', description: 'The separator pattern' },
      { name: 'limit', type: 'number', description: 'Maximum number of splits', optional: true },
    ],
    returnType: 'array<string>',
    category: 'String',
    examples: ['$split("a,b,c", ",") → ["a", "b", "c"]'],
  },
  {
    name: '$join',
    signature: '$join(array, separator?)',
    description: 'Joins array elements into a string',
    parameters: [
      { name: 'array', type: 'array<string>', description: 'The array to join' },
      { name: 'separator', type: 'string', description: 'Separator between elements (default: empty)', optional: true },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$join(["a", "b", "c"], ",") → "a,b,c"'],
  },
  {
    name: '$replace',
    signature: '$replace(str, pattern, replacement, limit?)',
    description: 'Replaces occurrences of pattern with replacement',
    parameters: [
      { name: 'str', type: 'string', description: 'The source string' },
      { name: 'pattern', type: 'string | regex', description: 'The pattern to find' },
      { name: 'replacement', type: 'string', description: 'The replacement text' },
      { name: 'limit', type: 'number', description: 'Maximum replacements', optional: true },
    ],
    returnType: 'string',
    category: 'String',
    examples: ['$replace("hello", "l", "L") → "heLLo"'],
  },
  {
    name: '$match',
    signature: '$match(str, pattern, limit?)',
    description: 'Returns an array of matches for the pattern',
    parameters: [
      { name: 'str', type: 'string', description: 'The string to search' },
      { name: 'pattern', type: 'regex', description: 'The regex pattern' },
      { name: 'limit', type: 'number', description: 'Maximum matches', optional: true },
    ],
    returnType: 'array<object>',
    category: 'String',
  },

  // Number functions
  {
    name: '$number',
    signature: '$number(value)',
    description: 'Converts a value to a number',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to convert' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$number("123") → 123', '$number("12.5") → 12.5'],
  },
  {
    name: '$abs',
    signature: '$abs(number)',
    description: 'Returns the absolute value',
    parameters: [
      { name: 'number', type: 'number', description: 'The number' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$abs(-5) → 5'],
  },
  {
    name: '$floor',
    signature: '$floor(number)',
    description: 'Rounds down to the nearest integer',
    parameters: [
      { name: 'number', type: 'number', description: 'The number to round' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$floor(3.7) → 3'],
  },
  {
    name: '$ceil',
    signature: '$ceil(number)',
    description: 'Rounds up to the nearest integer',
    parameters: [
      { name: 'number', type: 'number', description: 'The number to round' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$ceil(3.2) → 4'],
  },
  {
    name: '$round',
    signature: '$round(number, precision?)',
    description: 'Rounds to the specified precision',
    parameters: [
      { name: 'number', type: 'number', description: 'The number to round' },
      { name: 'precision', type: 'number', description: 'Decimal places (default: 0)', optional: true },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$round(3.456, 2) → 3.46'],
  },
  {
    name: '$power',
    signature: '$power(base, exponent)',
    description: 'Returns base raised to the power of exponent',
    parameters: [
      { name: 'base', type: 'number', description: 'The base number' },
      { name: 'exponent', type: 'number', description: 'The exponent' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$power(2, 3) → 8'],
  },
  {
    name: '$sqrt',
    signature: '$sqrt(number)',
    description: 'Returns the square root',
    parameters: [
      { name: 'number', type: 'number', description: 'The number' },
    ],
    returnType: 'number',
    category: 'Number',
    examples: ['$sqrt(16) → 4'],
  },
  {
    name: '$random',
    signature: '$random()',
    description: 'Returns a random number between 0 and 1',
    parameters: [],
    returnType: 'number',
    category: 'Number',
    examples: ['$random() → 0.7231...'],
  },
  {
    name: '$formatNumber',
    signature: '$formatNumber(number, picture, options?)',
    description: 'Formats a number using a picture string',
    parameters: [
      { name: 'number', type: 'number', description: 'The number to format' },
      { name: 'picture', type: 'string', description: 'Format pattern' },
      { name: 'options', type: 'object', description: 'Formatting options', optional: true },
    ],
    returnType: 'string',
    category: 'Number',
  },

  // Array functions
  {
    name: '$count',
    signature: '$count(array)',
    description: 'Returns the number of elements in an array',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to count' },
    ],
    returnType: 'number',
    category: 'Array',
    examples: ['$count([1, 2, 3]) → 3'],
  },
  {
    name: '$sum',
    signature: '$sum(array)',
    description: 'Returns the sum of numeric array elements',
    parameters: [
      { name: 'array', type: 'array<number>', description: 'Array of numbers' },
    ],
    returnType: 'number',
    category: 'Array',
    examples: ['$sum([1, 2, 3]) → 6'],
  },
  {
    name: '$max',
    signature: '$max(array)',
    description: 'Returns the maximum value in an array',
    parameters: [
      { name: 'array', type: 'array<number>', description: 'Array of numbers' },
    ],
    returnType: 'number',
    category: 'Array',
    examples: ['$max([1, 5, 3]) → 5'],
  },
  {
    name: '$min',
    signature: '$min(array)',
    description: 'Returns the minimum value in an array',
    parameters: [
      { name: 'array', type: 'array<number>', description: 'Array of numbers' },
    ],
    returnType: 'number',
    category: 'Array',
    examples: ['$min([1, 5, 3]) → 1'],
  },
  {
    name: '$average',
    signature: '$average(array)',
    description: 'Returns the average of numeric array elements',
    parameters: [
      { name: 'array', type: 'array<number>', description: 'Array of numbers' },
    ],
    returnType: 'number',
    category: 'Array',
    examples: ['$average([1, 2, 3]) → 2'],
  },
  {
    name: '$append',
    signature: '$append(array1, array2)',
    description: 'Concatenates two arrays',
    parameters: [
      { name: 'array1', type: 'array', description: 'First array' },
      { name: 'array2', type: 'array', description: 'Second array' },
    ],
    returnType: 'array',
    category: 'Array',
    examples: ['$append([1, 2], [3, 4]) → [1, 2, 3, 4]'],
  },
  {
    name: '$reverse',
    signature: '$reverse(array)',
    description: 'Reverses the order of array elements',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to reverse' },
    ],
    returnType: 'array',
    category: 'Array',
    examples: ['$reverse([1, 2, 3]) → [3, 2, 1]'],
  },
  {
    name: '$shuffle',
    signature: '$shuffle(array)',
    description: 'Randomly shuffles array elements',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to shuffle' },
    ],
    returnType: 'array',
    category: 'Array',
  },
  {
    name: '$sort',
    signature: '$sort(array, function?)',
    description: 'Sorts array elements',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to sort' },
      { name: 'function', type: 'function', description: 'Comparison function', optional: true },
    ],
    returnType: 'array',
    category: 'Array',
    examples: ['$sort([3, 1, 2]) → [1, 2, 3]'],
  },
  {
    name: '$distinct',
    signature: '$distinct(array)',
    description: 'Returns unique values from an array',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to dedupe' },
    ],
    returnType: 'array',
    category: 'Array',
    examples: ['$distinct([1, 2, 1, 3]) → [1, 2, 3]'],
  },
  {
    name: '$zip',
    signature: '$zip(array1, array2, ...)',
    description: 'Zips multiple arrays together',
    parameters: [
      { name: 'arrays', type: 'array...', description: 'Arrays to zip' },
    ],
    returnType: 'array<array>',
    category: 'Array',
    examples: ['$zip([1, 2], ["a", "b"]) → [[1, "a"], [2, "b"]]'],
  },

  // Object functions
  {
    name: '$keys',
    signature: '$keys(object)',
    description: 'Returns an array of object keys',
    parameters: [
      { name: 'object', type: 'object', description: 'The object' },
    ],
    returnType: 'array<string>',
    category: 'Object',
    examples: ['$keys({"a": 1, "b": 2}) → ["a", "b"]'],
  },
  {
    name: '$lookup',
    signature: '$lookup(object, key)',
    description: 'Returns the value for a key in an object',
    parameters: [
      { name: 'object', type: 'object', description: 'The object to search' },
      { name: 'key', type: 'string', description: 'The key to look up' },
    ],
    returnType: 'any',
    category: 'Object',
    examples: ['$lookup({"a": 1}, "a") → 1'],
  },
  {
    name: '$spread',
    signature: '$spread(object)',
    description: 'Converts an object to an array of key-value pairs',
    parameters: [
      { name: 'object', type: 'object', description: 'The object to spread' },
    ],
    returnType: 'array<object>',
    category: 'Object',
    examples: ['$spread({"a": 1}) → [{"a": 1}]'],
  },
  {
    name: '$merge',
    signature: '$merge(array)',
    description: 'Merges an array of objects into a single object',
    parameters: [
      { name: 'array', type: 'array<object>', description: 'Array of objects to merge' },
    ],
    returnType: 'object',
    category: 'Object',
    examples: ['$merge([{"a": 1}, {"b": 2}]) → {"a": 1, "b": 2}'],
  },
  {
    name: '$sift',
    signature: '$sift(object, function)',
    description: 'Filters object properties using a predicate function',
    parameters: [
      { name: 'object', type: 'object', description: 'The object to filter' },
      { name: 'function', type: 'function', description: 'Predicate function' },
    ],
    returnType: 'object',
    category: 'Object',
  },
  {
    name: '$each',
    signature: '$each(object, function)',
    description: 'Applies a function to each key-value pair',
    parameters: [
      { name: 'object', type: 'object', description: 'The object to iterate' },
      { name: 'function', type: 'function', description: 'Function to apply' },
    ],
    returnType: 'array',
    category: 'Object',
  },

  // Boolean functions
  {
    name: '$boolean',
    signature: '$boolean(value)',
    description: 'Converts a value to boolean',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to convert' },
    ],
    returnType: 'boolean',
    category: 'Boolean',
    examples: ['$boolean(0) → false', '$boolean("hello") → true'],
  },
  {
    name: '$not',
    signature: '$not(value)',
    description: 'Returns the logical NOT of a value',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to negate' },
    ],
    returnType: 'boolean',
    category: 'Boolean',
    examples: ['$not(true) → false'],
  },
  {
    name: '$exists',
    signature: '$exists(value)',
    description: 'Returns true if the value exists (not undefined)',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to check' },
    ],
    returnType: 'boolean',
    category: 'Boolean',
    examples: ['$exists(payload.name) → true (if name exists)'],
  },

  // Date/Time functions
  {
    name: '$now',
    signature: '$now(picture?, timezone?)',
    description: 'Returns the current timestamp in milliseconds or formatted',
    parameters: [
      { name: 'picture', type: 'string', description: 'Format pattern', optional: true },
      { name: 'timezone', type: 'string', description: 'Timezone', optional: true },
    ],
    returnType: 'number | string',
    category: 'Date',
    examples: ['$now() → 1703433600000'],
  },
  {
    name: '$millis',
    signature: '$millis()',
    description: 'Returns current timestamp in milliseconds',
    parameters: [],
    returnType: 'number',
    category: 'Date',
  },
  {
    name: '$fromMillis',
    signature: '$fromMillis(millis, picture?, timezone?)',
    description: 'Converts milliseconds to formatted date string',
    parameters: [
      { name: 'millis', type: 'number', description: 'Timestamp in milliseconds' },
      { name: 'picture', type: 'string', description: 'Format pattern', optional: true },
      { name: 'timezone', type: 'string', description: 'Timezone', optional: true },
    ],
    returnType: 'string',
    category: 'Date',
  },
  {
    name: '$toMillis',
    signature: '$toMillis(timestamp, picture?)',
    description: 'Parses a date string to milliseconds',
    parameters: [
      { name: 'timestamp', type: 'string', description: 'Date string to parse' },
      { name: 'picture', type: 'string', description: 'Format pattern', optional: true },
    ],
    returnType: 'number',
    category: 'Date',
  },

  // Higher-order functions
  {
    name: '$map',
    signature: '$map(array, function)',
    description: 'Applies a function to each element and returns a new array',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to map' },
      { name: 'function', type: 'function', description: 'Function to apply' },
    ],
    returnType: 'array',
    category: 'Higher-Order',
    examples: ['$map([1, 2, 3], $string) → ["1", "2", "3"]'],
  },
  {
    name: '$filter',
    signature: '$filter(array, function)',
    description: 'Filters array elements using a predicate function',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to filter' },
      { name: 'function', type: 'function', description: 'Predicate function' },
    ],
    returnType: 'array',
    category: 'Higher-Order',
  },
  {
    name: '$reduce',
    signature: '$reduce(array, function, init?)',
    description: 'Reduces an array to a single value',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to reduce' },
      { name: 'function', type: 'function', description: 'Reducer function' },
      { name: 'init', type: 'any', description: 'Initial value', optional: true },
    ],
    returnType: 'any',
    category: 'Higher-Order',
  },
  {
    name: '$single',
    signature: '$single(array, function?)',
    description: 'Returns the single matching element or throws error',
    parameters: [
      { name: 'array', type: 'array', description: 'The array to search' },
      { name: 'function', type: 'function', description: 'Predicate function', optional: true },
    ],
    returnType: 'any',
    category: 'Higher-Order',
  },

  // Misc functions
  {
    name: '$type',
    signature: '$type(value)',
    description: 'Returns the type of a value as a string',
    parameters: [
      { name: 'value', type: 'any', description: 'The value to check' },
    ],
    returnType: 'string',
    category: 'Misc',
    examples: ['$type("hello") → "string"', '$type([1,2]) → "array"'],
  },
  {
    name: '$assert',
    signature: '$assert(condition, message)',
    description: 'Throws an error if condition is false',
    parameters: [
      { name: 'condition', type: 'boolean', description: 'Condition to check' },
      { name: 'message', type: 'string', description: 'Error message' },
    ],
    returnType: 'undefined',
    category: 'Misc',
  },
  {
    name: '$error',
    signature: '$error(message)',
    description: 'Throws an error with the specified message',
    parameters: [
      { name: 'message', type: 'string', description: 'Error message' },
    ],
    returnType: 'never',
    category: 'Misc',
  },
  {
    name: '$eval',
    signature: '$eval(expr, context?)',
    description: 'Evaluates a JSONata expression string',
    parameters: [
      { name: 'expr', type: 'string', description: 'Expression to evaluate' },
      { name: 'context', type: 'object', description: 'Evaluation context', optional: true },
    ],
    returnType: 'any',
    category: 'Misc',
  },
  {
    name: '$uuid',
    signature: '$uuid()',
    description: 'Generates a UUID v4',
    parameters: [],
    returnType: 'string',
    category: 'Misc',
    examples: ['$uuid() → "550e8400-e29b-41d4-a716-446655440000"'],
  },
  {
    name: '$encodeUrl',
    signature: '$encodeUrl(str)',
    description: 'URL encodes a string',
    parameters: [
      { name: 'str', type: 'string', description: 'String to encode' },
    ],
    returnType: 'string',
    category: 'Misc',
  },
  {
    name: '$decodeUrl',
    signature: '$decodeUrl(str)',
    description: 'URL decodes a string',
    parameters: [
      { name: 'str', type: 'string', description: 'String to decode' },
    ],
    returnType: 'string',
    category: 'Misc',
  },
  {
    name: '$base64encode',
    signature: '$base64encode(str)',
    description: 'Base64 encodes a string',
    parameters: [
      { name: 'str', type: 'string', description: 'String to encode' },
    ],
    returnType: 'string',
    category: 'Misc',
  },
  {
    name: '$base64decode',
    signature: '$base64decode(str)',
    description: 'Base64 decodes a string',
    parameters: [
      { name: 'str', type: 'string', description: 'Base64 string to decode' },
    ],
    returnType: 'string',
    category: 'Misc',
  },
];

/**
 * Get functions by category
 */
export function getFunctionsByCategory(): Map<string, FunctionDefinition[]> {
  const categories = new Map<string, FunctionDefinition[]>();
  for (const fn of builtinFunctions) {
    const list = categories.get(fn.category) || [];
    list.push(fn);
    categories.set(fn.category, list);
  }
  return categories;
}

/**
 * Find a function by name
 */
export function findFunction(name: string): FunctionDefinition | undefined {
  return builtinFunctions.find(fn => fn.name === name);
}
