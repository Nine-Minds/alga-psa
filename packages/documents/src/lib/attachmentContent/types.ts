import type { LimitName } from './limits';

/** Structurally identical to agent-tooling's McpContentBlock (the wire contract); kept local so documents has no agent-tooling dependency. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string; size?: number; description?: string };

export interface AttachmentDocument {
  document_id: string;
  document_name: string;
  mime_type: string | null;
  file_id: string | null;
  file_size: number | null;
  updated_at: string;
}

export interface AttachmentSource {
  document: AttachmentDocument;
  /** Lazy: called at most once per request (the engine memoizes), only by producers that need bytes. */
  loadBytes(): Promise<Buffer>;
  /** In-app (BlockNote / text) body for documents without a file. */
  loadInAppMarkdown(): Promise<string | null>;
}

export interface UnitCost {
  images: number;
  /** Lower bound known before materializing (0 when unknown). */
  encodedBytes: number;
  textChars: number;
}

export type UnitRendering = 'image' | 'original' | 'text' | 'page_image' | 'link';

export interface OmissionInfo {
  reason: string;
}

export interface UnitOutput {
  /** One line placed in front of the blocks. */
  label: string;
  /** Body blocks. Budget accounting is computed from these. */
  blocks: ContentBlock[];
  rendering: UnitRendering;
  /** 1-based PDF page, for page units. */
  page?: number;
  /** Set when this unit stands in for content that could not be delivered. */
  omitted?: OmissionInfo;
}

export interface ContentUnit {
  /** May read cheap metadata (a PDF page's text layer) so the packer can refuse a unit BEFORE the expensive render. */
  cost(): UnitCost | Promise<UnitCost>;
  materialize(): Promise<UnitOutput>;
}

export interface UnitList {
  total: number;
  unit(index: number): ContentUnit;
  /** "pages 1-6 of 14", "chunk 2 of 3", or null when the range is the whole attachment. */
  describeRange(from: number, to: number): string | null;
}

export interface ProducerCtx {
  /** `[3/22] IMG_0412.jpg` */
  tag: string;
  effectiveMime: string;
  /** Present when the declared and detected types disagree. */
  mimeNote: string | null;
  documentUri(documentId: string): string;
  /** Render PDF pages to PNG buffers (injectable; defaults to pdf2pic). */
  renderPdfPages(pdf: Buffer, pages: readonly number[]): Promise<Buffer[]>;
  /** Run when the call ends (temp files). */
  onDispose(fn: () => Promise<void> | void): void;
}

/** Thrown by a producer that cannot open the attachment; the engine falls back to a link. */
export class ProducerUnreadable extends Error {
  constructor(public readonly reason: string, message?: string) {
    super(message ?? reason);
    this.name = 'ProducerUnreadable';
  }
}

export interface AttachmentProducer {
  name: string;
  /** Exact MIME types and `type/*` wildcards this producer owns. */
  accepts: readonly string[];
  /** Input cap (bytes), checked against documents.file_size before any download. */
  maxBytes: number;
  units(source: AttachmentSource, bytes: Buffer, ctx: ProducerCtx): Promise<UnitList>;
}

export interface ReadPosition {
  docIndex: number;
  unitIndex: number;
}

export interface ServedRange {
  docIndex: number;
  document_id: string;
  name: string;
  mime_type: string;
  part: string | null;
  rendering: string;
  scanned_pages: number[];
}

export interface Omission {
  document_id: string;
  name: string;
  mime_type: string | null;
  reason: string;
}

export interface ReadResult {
  blocks: ContentBlock[];
  served: ServedRange[];
  omitted: Omission[];
  next: ReadPosition | null;
  limitsApplied: LimitName[];
  /** Human-readable summary of what is left, or null when complete. */
  remaining: string | null;
}
