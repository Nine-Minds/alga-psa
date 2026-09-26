export class DocumentRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'DocumentRequestError';
  }
}

export async function fetchAndSaveFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new DocumentRequestError(body.error || 'Document request failed', response.status, body.code);
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = (encoded ? decodeURIComponent(encoded) : plain) || fallbackName;
  const urlObject = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = urlObject;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(urlObject);
}
