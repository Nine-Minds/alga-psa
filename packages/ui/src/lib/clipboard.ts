/**
 * Copies text to the system clipboard, resolving to whether it landed.
 *
 * Browsers only expose `navigator.clipboard` on secure origins (https or
 * localhost), and may reject it even there. Self-hosted installs are often
 * reached over plain http on a LAN, so when the Clipboard API is missing or
 * rejects, this falls back to a hidden-textarea `execCommand('copy')`.
 * Never throws: callers branch on the result to show success or failure.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API can exist but reject outside a secure context.
    }
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}
