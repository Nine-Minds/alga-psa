// Minimal dev stub for `sharp` to avoid native dependency during local Next.js dev.
// It preserves basic chaining API used in the app and acts as a no-op converter.

type SharpOptions = Record<string, unknown>;

class SharpStub {
  private input: any;
  constructor(input?: any) {
    this.input = input;
  }
  resize(_w?: number, _h?: number, _opts?: SharpOptions) {
    return this;
  }
  webp(_opts?: SharpOptions) {
    return this;
  }
  png(_opts?: SharpOptions) {
    return this;
  }
  jpeg(_opts?: SharpOptions) {
    return this;
  }
  toBuffer(): Promise<Buffer> {
    if (Buffer.isBuffer(this.input)) return Promise.resolve(this.input);
    if (typeof this.input === 'string') return Promise.resolve(Buffer.from(this.input));
    return Promise.resolve(Buffer.alloc(0));
  }
  toFile(_path: string): Promise<{ size?: number }> {
    return Promise.resolve({ size: Buffer.isBuffer(this.input) ? this.input.length : 0 });
  }
  metadata(): Promise<Record<string, unknown>> {
    return Promise.resolve({});
  }
}

function sharp(input?: any) {
  return new SharpStub(input);
}

export default sharp;

