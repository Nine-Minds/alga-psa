export const MAX_EDITOR_IMAGE_BYTES = 10 * 1024 * 1024;

export interface EditorImageUploadResult {
  url: string;
  documentId: string;
}

type UploadDocumentAction = (
  formData: FormData,
  options: { userId: string; isClientVisible?: boolean }
) => Promise<any>;

export interface EditorImageUploadOptions {
  userId: string;
  uploadDocumentAction?: UploadDocumentAction;
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

/**
 * Uploads an inline editor image into the documents store and returns the URL
 * to reference it by.
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
  { userId, uploadDocumentAction }: EditorImageUploadOptions
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

  const formData = new FormData();
  formData.append('file', file);

  const result = await uploadAction(formData, { userId, isClientVisible: true });

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
  for (const file of files) {
    try {
      const { url } = await uploadEditorImage(file, options);
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
