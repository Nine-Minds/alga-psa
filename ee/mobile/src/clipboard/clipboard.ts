import * as Clipboard from "expo-clipboard";
import { getClipboardText, type ClipboardCopyOptions } from "./clipboardLogic";

export { getClipboardText, type ClipboardCopyOptions } from "./clipboardLogic";

export async function copyToClipboard(
  label: string,
  value: string,
  options: ClipboardCopyOptions = {},
): Promise<{ copiedText: string; redacted: boolean }> {
  const next = getClipboardText(label, value, options);
  await Clipboard.setStringAsync(next.text);
  return { copiedText: next.text, redacted: next.redacted };
}

