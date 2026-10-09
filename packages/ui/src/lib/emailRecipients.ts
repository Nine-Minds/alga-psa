export const EMAIL_RECIPIENT_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export interface ParsedEmailRecipient {
  email: string;
  name?: string;
}

/**
 * Parses typed or pasted addresses: comma, semicolon or newline separated, each
 * either `ada@example.com` or `Ada Lovelace <ada@example.com>`. Returns the
 * valid recipients and the entries that aren't addresses.
 *
 * Shared by the workflow designer's recipient editor and the ticket comment
 * Cc/Bcc chip input so both split and validate identically.
 */
export function parseEmailRecipients(text: string): {
  recipients: ParsedEmailRecipient[];
  invalid: string[];
} {
  const recipients: ParsedEmailRecipient[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const named = /^(.*?)\s*<([^>]+)>$/.exec(entry);
    const email = (named ? named[2] : entry).trim();
    const name = named ? named[1].trim().replace(/^"|"$/g, '') : '';
    if (EMAIL_RECIPIENT_PATTERN.test(email)) {
      recipients.push(name ? { email, name } : { email });
    } else {
      invalid.push(entry);
    }
  }
  return { recipients, invalid };
}
