/** @module Interface wasi:io/streams@0.2.3 **/
export type Error = import('./wasi-io-error.js').Error;
export type StreamError = StreamErrorLastOperationFailed | StreamErrorClosed;
export interface StreamErrorLastOperationFailed {
  tag: 'last-operation-failed',
  val: Error,
}
export interface StreamErrorClosed {
  tag: 'closed',
}
export type Pollable = import('./wasi-io-poll.js').Pollable;

export class InputStream {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  read(len: bigint): Uint8Array;
  blockingRead(len: bigint): Uint8Array;
  subscribe(): Pollable;
}

export class OutputStream {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  checkWrite(): bigint;
  write(contents: Uint8Array): void;
  blockingWriteAndFlush(contents: Uint8Array): void;
  blockingFlush(): void;
  subscribe(): Pollable;
}
