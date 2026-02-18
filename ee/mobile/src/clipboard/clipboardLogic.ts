const REDACTED = "[REDACTED]";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type ClipboardCopyOptions = {
  allowSensitive?: boolean;
  sensitive?: boolean;
};

function looksSensitive(label: string, value: string): boolean {
  if (UUID_RE.test(value)) return false;

  const normalizedLabel = label.trim().toLowerCase();
  const sensitiveLabel =
    normalizedLabel.includes("token") ||
    normalizedLabel.includes("password") ||
    normalizedLabel.includes("secret") ||
    normalizedLabel.includes("ott") ||
    normalizedLabel.includes("state") ||
    normalizedLabel.includes("api key") ||
    normalizedLabel.includes("apikey");

  if (sensitiveLabel) return true;
  if (/^Bearer\s+/i.test(value)) return true;
  if (JWT_RE.test(value)) return true;
  return false;
}

function redactForClipboard(value: string): string {
  if (/^Bearer\s+/i.test(value)) return value.replace(/^Bearer\s+\S+/i, `Bearer ${REDACTED}`);
  if (JWT_RE.test(value)) return `${value.split(".")[0]}.${REDACTED}.${REDACTED}`;
  return REDACTED;
}

export function getClipboardText(
  label: string,
  value: string,
  options: ClipboardCopyOptions = {},
): { text: string; redacted: boolean } {
  const shouldTreatAsSensitive =
    options.sensitive ?? looksSensitive(label, value);
  if (!shouldTreatAsSensitive || options.allowSensitive) {
    return { text: value, redacted: false };
  }
  return { text: redactForClipboard(value), redacted: true };
}
