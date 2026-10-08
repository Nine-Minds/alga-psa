/**
 * English wording for every message the client/contact field validators emit
 * (`clients.validation.*`). This is the single source: the web keeps a copy
 * under `common.clients.validation` in server/public/locales/en/common.json
 * (its translators work from locale files), guarded by a test that fails
 * when the two drift; mobile loads this object straight into its `common`
 * namespace.
 */
export const CLIENT_VALIDATION_MESSAGES_EN = {
  "clientName": {
    "structural": "Please enter a valid client name",
    "required": "Client name is required",
    "emojiOnly": "This name is made up entirely of emoji.",
    "tooShort": "This name is a single character — is that right?",
    "abbreviationOnly": "This is only a business abbreviation, not a name.",
    "repeatedCharacters": "This name repeats the same character several times.",
    "looksLikeUrl": "This looks like a web address rather than a name.",
    "noLettersOrNumbers": "This name has no letters or numbers in it."
  },
  "contactName": {
    "structural": "Please enter a valid contact name",
    "placeholder": "This looks like a placeholder rather than a person."
  },
  "email": {
    "structural": "Please enter a valid email address",
    "required": "Email address is required",
    "disposableDomain": "{{domain}} is a disposable mailbox provider.",
    "reservedDomain": "{{domain}} is reserved for documentation and testing.",
    "internalDomain": "{{domain}} only resolves inside a private network."
  },
  "url": {
    "structural": "Please enter a valid website URL (e.g., apple.com)",
    "ipAddress": "This is an IP address rather than a domain name.",
    "internalHost": "{{host}} only resolves inside a private network.",
    "reservedDomain": "{{host}} is reserved for documentation and testing."
  },
  "phone": {
    "structural": "Please enter a valid phone number",
    "repeatedDigits": "This number is the same digit repeated.",
    "sequentialDigits": "This number runs straight up or down the keypad.",
    "fictionalRange": "This is in the 555-0100 range reserved for fiction."
  },
  "dismissWarning": "Dismiss",
  "address": {
    "emoji": "Address cannot contain emojis",
    "empty": "Address cannot be empty",
    "invalidCharacters": "Address contains invalid characters",
    "noLetters": "Address must contain letters",
    "tooLong": "Address must be 100 characters or less"
  },
  "city": {
    "emoji": "City name cannot contain emojis",
    "empty": "City name cannot be empty",
    "invalidCharacters": "City name contains invalid characters",
    "noLetters": "City name must contain letters",
    "tooLong": "City name must be 100 characters or less"
  },
  "stateProvince": {
    "emoji": "State/Province cannot contain emojis",
    "empty": "State/Province cannot be empty",
    "invalidCharacters": "State/Province contains invalid characters",
    "noLetters": "State/Province must contain letters",
    "tooLong": "State/Province must be 100 characters or less"
  },
  "postalCode": {
    "au": "Please enter a valid Australian postal code (e.g., 2000)",
    "br": "Please enter a valid Brazilian postal code (e.g., 01234-567)",
    "ca": "Please enter a valid Canadian postal code (e.g., K1A 0A6)",
    "ch": "Please enter a valid Swiss postal code (e.g., 8001)",
    "de": "Please enter a valid German postal code (e.g., 10115)",
    "emoji": "Postal code cannot contain emojis",
    "es": "Please enter a valid Spanish postal code (e.g., 28001)",
    "fr": "Please enter a valid French postal code (e.g., 75001)",
    "gb": "Please enter a valid UK postal code (e.g., SW1A 1AA)",
    "generic": "Please enter a valid postal code",
    "in": "Please enter a valid Indian postal code (e.g., 110001)",
    "it": "Please enter a valid Italian postal code (e.g., 00118)",
    "jp": "Please enter a valid Japanese postal code (e.g., 123-4567)",
    "nl": "Please enter a valid Dutch postal code (e.g., 1234AB)",
    "onlySpaces": "Postal code cannot contain only spaces",
    "us": "Please enter a valid ZIP code (e.g., 12345 or 12345-6789)",
    "usShort": "Please enter a valid ZIP code"
  },
  "industry": {
    "invalidCharacters": "Industry contains invalid characters",
    "noLetters": "Industry must contain letters",
    "tooLong": "Industry must be 100 characters or less",
    "tooShort": "Industry must be at least 2 characters long",
    "tooShortText": "Industry must contain at least 2 text characters"
  },
  "role": {
    "noAlphanumeric": "Role must contain letters or numbers",
    "onlySpaces": "Role cannot contain only spaces",
    "tooLong": "Role must be 100 characters or less"
  },
  "notes": {
    "tooLong": "Notes must be 2000 characters or less"
  },
  "companySize": {
    "emoji": "Company size cannot contain emojis",
    "invalid": "Please enter a valid company size (e.g., \"50\", \"10-50\", \"five hundred\", \"2.5M\", \"small\", \"enterprise\")",
    "tooLong": "Company size must be 50 characters or less"
  },
  "annualRevenue": {
    "emoji": "Annual revenue cannot contain emojis",
    "invalid": "Please enter valid annual revenue (e.g., \"$1,000,000\", \"five million\", \"2.5M\", \"10M-50M\", \"not disclosed\")",
    "tooLong": "Annual revenue must be 50 characters or less"
  }
} as const;

/** Shape to merge into an i18n `common` namespace: `{ clients: { validation } }`. */
export const CLIENT_VALIDATION_RESOURCE_EN = { clients: { validation: CLIENT_VALIDATION_MESSAGES_EN } };
