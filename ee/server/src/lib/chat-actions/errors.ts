/**
 * Authorization failures raised by the chat persistence boundary.
 *
 * Kept in a plain module (not the `'use server'` action file) so both the
 * server actions and the models can distinguish "the caller may not touch this
 * row" from "persistence is unavailable" without exporting a value from a
 * `'use server'` file.
 */
export class ChatAccessDeniedError extends Error {
  constructor(message = 'Chat access denied') {
    super(message);
    this.name = 'ChatAccessDeniedError';
  }
}

export function isChatAccessDeniedError(error: unknown): error is ChatAccessDeniedError {
  return (
    error instanceof ChatAccessDeniedError ||
    (error instanceof Error && error.name === 'ChatAccessDeniedError')
  );
}
