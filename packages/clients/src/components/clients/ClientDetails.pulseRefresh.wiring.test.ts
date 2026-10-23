import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientDetailsSource = readFileSync(
  new URL('./ClientDetails.tsx', import.meta.url),
  'utf8'
);

/** The save handler's body, from its declaration to the shortcut registration. */
function saveHandlerBody(): string {
  const start = clientDetailsSource.indexOf('const handleSave = useCallback');
  const end = clientDetailsSource.indexOf('usePageSaveShortcut(handleSave', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return clientDetailsSource.slice(start, end);
}

describe('ClientDetails pulse refresh wiring', () => {
  it('bumps the pulse nonce after a successful record save', () => {
    // Account manager, default contact and client since all live on this form
    // and are summarized by the overview's record card. Without the bump the
    // card kept the pre-save values until the page was reloaded.
    const body = saveHandlerBody();
    expect(body).toContain('setPulseRefreshNonce((nonce) => nonce + 1);');

    // After the update resolved, not on the error path.
    const saveIndex = body.indexOf('const updatedClient = updatedClientResult as IClient;');
    expect(saveIndex).toBeGreaterThan(-1);
    expect(body.indexOf('setPulseRefreshNonce')).toBeGreaterThan(saveIndex);
  });

  it('feeds that nonce into the command center', () => {
    expect(clientDetailsSource).toContain('refreshNonce={pulseRefreshNonce}');
  });
});
