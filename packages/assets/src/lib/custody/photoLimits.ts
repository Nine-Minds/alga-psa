/** Leaves room for multipart framing under the default 20 MB server-action limit. */
export const MAX_CUSTODY_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_CUSTODY_PHOTOS = 20;

export function custodyPhotosWithinLimit(files: readonly { size: number }[]): boolean {
  return files.length <= MAX_CUSTODY_PHOTOS && files.reduce((sum, file) => sum + file.size, 0) <= MAX_CUSTODY_PHOTO_BYTES;
}
