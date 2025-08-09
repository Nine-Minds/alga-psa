const map: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8'
};

export function contentTypeFor(filename: string): string {
  const i = filename.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  return map[filename.slice(i).toLowerCase()] || 'application/octet-stream';
}

