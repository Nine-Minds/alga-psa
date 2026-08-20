export const SUPPORT_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 64 * 1024;

const TERMINAL_HEADER_BYTES = 10;
const TERMINAL_FRAME_TYPES = Object.freeze({
  input: 1,
  output: 2,
});
const TERMINAL_FRAME_NAMES = new Map(Object.entries(TERMINAL_FRAME_TYPES).map(([name, value]) => [value, name]));

function requireSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Terminal frame sequence is invalid.');
  return BigInt(value);
}

export function encodeTerminalFrame({ type, seq, data }) {
  const typeId = TERMINAL_FRAME_TYPES[type];
  if (!typeId) throw new Error('Terminal frame type is invalid.');
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  if (!payload.length || payload.length + TERMINAL_HEADER_BYTES > MAX_FRAME_BYTES) throw new Error('Terminal frame payload is invalid.');
  const frame = Buffer.allocUnsafe(TERMINAL_HEADER_BYTES + payload.length);
  frame.writeUInt8(SUPPORT_PROTOCOL_VERSION, 0);
  frame.writeUInt8(typeId, 1);
  frame.writeBigUInt64BE(requireSequence(seq), 2);
  payload.copy(frame, TERMINAL_HEADER_BYTES);
  return frame;
}

export function decodeTerminalFrame(value) {
  const frame = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (frame.length <= TERMINAL_HEADER_BYTES || frame.length > MAX_FRAME_BYTES) throw new Error('Terminal frame size is invalid.');
  if (frame.readUInt8(0) !== SUPPORT_PROTOCOL_VERSION) throw new Error('Terminal frame version is invalid.');
  const type = TERMINAL_FRAME_NAMES.get(frame.readUInt8(1));
  if (!type) throw new Error('Terminal frame type is invalid.');
  const sequence = frame.readBigUInt64BE(2);
  if (sequence < 1n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Terminal frame sequence is invalid.');
  return { version: SUPPORT_PROTOCOL_VERSION, type, seq: Number(sequence), data: frame.subarray(TERMINAL_HEADER_BYTES) };
}

export function encodeControlFrame(message, seq) {
  const frame = { ...message, version: SUPPORT_PROTOCOL_VERSION, seq };
  const bytes = Buffer.from(JSON.stringify(frame), 'utf8');
  if (bytes.length > MAX_FRAME_BYTES) throw new Error('Support control frame exceeds the bounded size.');
  return bytes;
}

export function decodeControlFrame(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (!bytes.length || bytes.length > MAX_FRAME_BYTES) throw new Error('Support control frame size is invalid.');
  let message;
  try { message = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Support control frame is invalid JSON.'); }
  if (!message || message.version !== SUPPORT_PROTOCOL_VERSION) throw new Error('Support control frame version is invalid.');
  if (!Number.isSafeInteger(message.seq) || message.seq < 1) throw new Error('Support control frame sequence is invalid.');
  if (typeof message.type !== 'string' || !message.type) throw new Error('Support control frame envelope is invalid.');
  return message;
}

export const _private = { TERMINAL_HEADER_BYTES, TERMINAL_FRAME_TYPES };
