export const MAX_EDITOR_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Where an inline editor image is filed. One tenant-level folder rather than
 * root: eight pasted screenshots used to become eight top-level documents all
 * called image.png, indistinguishable from real library uploads.
 */
export const INLINE_IMAGE_FOLDER_PATH = '/Knowledge Base/Attachments';

export interface EditorImageUploadResult {
  url: string;
  documentId: string;
}

type UploadDocumentAction = (
  formData: FormData,
  options: {
    userId: string;
    isClientVisible?: boolean;
    folder_path?: string | null;
    parentDocumentId?: string;
  }
) => Promise<any>;

export interface EditorImageUploadOptions {
  userId: string;
  uploadDocumentAction?: UploadDocumentAction;
  /** The document being edited. Associates the image so it is reachable from it. */
  parentDocumentId?: string;
  /** Article slug (or other stable label) used to name the stored file. */
  namePrefix?: string;
  /** Position within a multi-file paste, so the names of a batch stay ordered. */
  sequence?: number;
}

/** Rejection reasons the editor has to say something specific about. */
export type EditorImageUploadErrorCode = 'tooLarge' | 'notAnImage' | 'noSession' | 'failed';

export class EditorImageUploadError extends Error {
  constructor(
    readonly code: EditorImageUploadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'EditorImageUploadError';
  }
}

/**
 * Turns an upload rejection into something worth showing the author. Pasting a
 * screenshot that is quietly discarded while the editor still says "All changes
 * saved" is worse than an error, so every path here produces a message.
 */
export function editorImageUploadMessage(
  error: unknown,
  translate: (key: string, options: { defaultValue: string }) => string
): string {
  if (error instanceof EditorImageUploadError && error.code !== 'failed') {
    return translate(`editor.imageUpload.${error.code}`, { defaultValue: error.message });
  }
  // Storage and permission failures already carry a server-authored message.
  if (error instanceof Error && error.message) return error.message;
  return translate('editor.imageUpload.failed', { defaultValue: 'Image upload failed' });
}

export const isEditorImageFile = (file: { type?: string | null } | null | undefined): boolean =>
  Boolean(file?.type?.toLowerCase().startsWith('image/'));

export const extractImageFiles = (
  list: ArrayLike<{ kind?: string; type?: string; getAsFile?: () => File | null }> | null | undefined
): File[] => {
  const files: File[] = [];
  for (let index = 0; index < (list?.length ?? 0); index += 1) {
    const item = list![index];
    if (!item || item.kind !== 'file' || !isEditorImageFile(item)) continue;
    const file = item.getAsFile?.() ?? null;
    if (file) files.push(file);
  }
  return files;
};

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

const IMAGE_EXTENSION_OVERRIDES: Record<string, string> = { jpeg: 'jpg', 'svg+xml': 'svg' };

const imageExtension = (mimeType: string | null | undefined): string => {
  const subtype = String(mimeType ?? '').toLowerCase().split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'png';
  return IMAGE_EXTENSION_OVERRIDES[subtype] ?? (subtype.replace(/[^a-z0-9]/g, '') || 'png');
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * Names a stored inline image after the article it was pasted into, following
 * the ticket-comment convention in packages/tickets clipboardImageUtils. Chrome
 * calls every clipboard bitmap "image.png", so without this a library listing
 * is a wall of identical rows.
 */
export function createInlineImageFilename(params: {
  namePrefix?: string;
  timestamp: Date;
  sequence: number;
  mimeType?: string | null;
}): string {
  const { namePrefix, timestamp, sequence, mimeType } = params;
  const prefix = slugify(namePrefix ?? '') || 'inline-image';
  const stamp =
    `${timestamp.getUTCFullYear()}${pad(timestamp.getUTCMonth() + 1)}${pad(timestamp.getUTCDate())}` +
    `-${pad(timestamp.getUTCHours())}${pad(timestamp.getUTCMinutes())}${pad(timestamp.getUTCSeconds())}`;

  return `${prefix}-${stamp}-${pad(sequence, 3)}.${imageExtension(mimeType)}`;
}

/**
 * Uploads an inline editor image into the documents store and returns the URL
 * to reference it by.
 *
 * Filed under INLINE_IMAGE_FOLDER_PATH and associated with the document being
 * edited, so the picture is reachable from the article it lives in instead of
 * sitting unattached in the library root.
 *
 * Inline images are always stored client-visible: publishing an article flips
 * the article document's visibility, never that of the images embedded in it.
 *
 * This clears the client-visibility gate in authorizeAndRedactDocuments, but it
 * is not on its own enough for a client-portal reader. That helper also runs the
 * built-in relationship rules (`own` / `same_client`), and an inline image has
 * no client association at all, so /api/documents/view still answers 403 for
 * client users. A KB article is readable by every client, which the relationship
 * kernel has no template for; giving embedded media a client-facing scope needs
 * its own decision and is not made here.
 */
export async function uploadEditorImage(
  file: File,
  { userId, uploadDocumentAction, parentDocumentId, namePrefix, sequence = 1 }: EditorImageUploadOptions
): Promise<EditorImageUploadResult> {
  if (!userId) {
    throw new EditorImageUploadError('noSession', 'User session is required to upload images');
  }
  if (!isEditorImageFile(file)) {
    throw new EditorImageUploadError('notAnImage', 'Only image files can be inserted into the editor');
  }
  if (file.size > MAX_EDITOR_IMAGE_BYTES) {
    throw new EditorImageUploadError('tooLarge', 'Image is larger than the 10 MB upload limit');
  }

  // Imported lazily on purpose: documentActions pulls puppeteer/pdf-lib/knex in,
  // which would land in the client bundle and in every test that renders an editor.
  const uploadAction =
    uploadDocumentAction ?? ((await import('../actions/documentActions')).uploadDocument as UploadDocumentAction);

  const storedName = createInlineImageFilename({
    namePrefix,
    timestamp: new Date(),
    sequence,
    mimeType: file.type,
  });

  const formData = new FormData();
  formData.append('file', file, storedName);

  const result = await uploadAction(formData, {
    userId,
    isClientVisible: true,
    folder_path: INLINE_IMAGE_FOLDER_PATH,
    ...(parentDocumentId ? { parentDocumentId } : {}),
  });

  if (!result || result.success !== true) {
    const reason =
      (result && (result.permissionError || result.error)) || 'Image upload failed';
    throw new EditorImageUploadError('failed', String(reason));
  }

  const uploaded = result.document;
  const url = uploaded.file_id
    ? `/api/documents/view/${uploaded.file_id}`
    : `/api/documents/download/${uploaded.document_id}`;

  return { url, documentId: uploaded.document_id };
}

interface ImageInsertChain {
  setTextSelection: (position: number) => ImageInsertChain;
  setImage: (attrs: { src: string; alt?: string }) => { run: () => void };
}

interface ImageInsertTarget {
  chain: () => { focus: () => ImageInsertChain };
}

/**
 * Uploads each file and drops an image node into the editor for it.
 *
 * `at` places the first image at a specific document position — a drop should
 * land where the file was dropped rather than replacing whatever text happened
 * to be selected. Later images follow the caret so a multi-file drop stays in
 * order.
 */
export async function insertUploadedImages(
  editor: ImageInsertTarget | null | undefined,
  files: File[],
  options: EditorImageUploadOptions & { onError?: (error: unknown) => void; at?: number }
): Promise<void> {
  let insertAt = options.at;
  let sequence = options.sequence ?? 1;
  for (const file of files) {
    try {
      const { url } = await uploadEditorImage(file, { ...options, sequence: sequence++ });
      const chain = editor?.chain().focus();
      if (!chain) continue;
      const positioned = typeof insertAt === 'number' ? chain.setTextSelection(insertAt) : chain;
      positioned.setImage({ src: url, alt: file.name }).run();
      insertAt = undefined;
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('[editorImageUpload] Image upload failed:', error);
      }
    }
  }
}
