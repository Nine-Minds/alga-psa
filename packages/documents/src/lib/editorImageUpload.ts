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
 * the article document's visibility, never that of the images embedded in it,
 * so without this a published article's pictures 403 in the client portal.
 */
export async function uploadEditorImage(
  file: File,
  { userId, uploadDocumentAction }: EditorImageUploadOptions
): Promise<EditorImageUploadResult> {
  if (!userId) {
    throw new Error('User session is required to upload images');
  }
  if (!isEditorImageFile(file)) {
    throw new Error('Only image files can be inserted into the editor');
  }
  if (file.size > MAX_EDITOR_IMAGE_BYTES) {
    throw new Error('Image is larger than the 10 MB upload limit');
  }

  const uploadAction =
    uploadDocumentAction ?? ((await import('../actions/documentActions')).uploadDocument as UploadDocumentAction);

  const formData = new FormData();
  formData.append('file', file);

  const result = await uploadAction(formData, { userId, isClientVisible: true });

  if (!result || result.success !== true) {
    const reason =
      (result && (result.permissionError || result.error)) || 'Image upload failed';
    throw new Error(String(reason));
  }

  const uploaded = result.document;
  const url = uploaded.file_id
    ? `/api/documents/view/${uploaded.file_id}`
    : `/api/documents/download/${uploaded.document_id}`;

  return { url, documentId: uploaded.document_id };
}

interface ImageInsertTarget {
  chain: () => {
    focus: () => {
      setImage: (attrs: { src: string; alt?: string }) => { run: () => void };
    };
  };
}

/** Uploads each file and drops an image node into the editor for it. */
export async function insertUploadedImages(
  editor: ImageInsertTarget | null | undefined,
  files: File[],
  options: EditorImageUploadOptions & { onError?: (error: unknown) => void }
): Promise<void> {
  for (const file of files) {
    try {
      const { url } = await uploadEditorImage(file, options);
      editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('[editorImageUpload] Image upload failed:', error);
      }
    }
  }
}
