'use client';

import * as React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import type { LogoCropRect } from '@alga-psa/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from './Dialog';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

// The circle sizes the mark actually lands in: table rows and the smallest cells.
const PREVIEW_SIZES = [32, 24];

export interface ImageCropDialogProps {
  isOpen: boolean;
  /** Source to cut from: an upload's object URL or the stored wide logo. */
  imageUrl: string | null;
  /** Read by assistive tech and as the fallback title. */
  imageName: string;
  onClose: () => void;
  onConfirm: (crop: LogoCropRect) => void | Promise<void>;
  isConfirming?: boolean;
  /** One sentence on where the chosen square ends up; the caller knows the slot. */
  helpText?: string;
  id?: string;
}

/**
 * Picks the square zone of a wide logo that avatar-sized slots will show. The
 * image covers a fixed-height stage and the round window stays put, so the user
 * drags the wordmark under it and zooms in on the part that reads as a mark.
 * Returns fractions of the source image, never pixels.
 */
export function ImageCropDialog({
  isOpen,
  imageUrl,
  imageName,
  onClose,
  onConfirm,
  isConfirming = false,
  helpText,
  id = 'image-crop-dialog',
}: ImageCropDialogProps) {
  const { t } = useTranslation('client-portal');
  const { t: tCore } = useTranslation('common');
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(MIN_ZOOM);
  const [area, setArea] = React.useState<Area | null>(null);

  // Every open starts centred; a stale offset from another image would land off-canvas.
  React.useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
      setArea(null);
    }
  }, [isOpen, imageUrl]);

  const handleConfirm = () => {
    if (!area) return;
    // react-easy-crop reports percentages; the server wants 0..1.
    void onConfirm({
      x: area.x / 100,
      y: area.y / 100,
      width: area.width / 100,
      height: area.height / 100,
    });
  };

  // Live circles rendered from the same percentages the server will receive,
  // so what the user sees here is exactly what the table gets.
  const previewStyle = (size: number): React.CSSProperties | null => {
    if (!area || area.width <= 0) return null;
    const scale = 100 / area.width;
    return {
      position: 'absolute',
      top: 0,
      left: 0,
      width: size,
      height: 'auto',
      transformOrigin: 'top left',
      transform: `translate3d(${-area.x * scale}%, ${-area.y * scale}%, 0) scale3d(${scale}, ${scale}, 1)`,
      maxWidth: 'none',
    };
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={id}
      title={t('profile.imageUpload.cropTitle', 'Choose the square mark')}
      forceModal
      className="max-w-2xl"
    >
      <DialogContent>
        <DialogDescription className="text-sm text-[rgb(var(--color-text-500))]">
          {helpText ?? t(
            'profile.imageUpload.cropHelp',
            'Drag the logo and zoom to pick the part shown in small, square spaces. The full logo is kept as well.'
          )}
        </DialogDescription>

        <div
          className="relative mt-4 h-64 w-full overflow-hidden rounded-md bg-[rgb(var(--color-border-100))]"
          data-automation-id={`${id}-stage`}
        >
          {imageUrl && (
            <Cropper
              image={imageUrl}
              crop={position}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              objectFit="cover"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onCropChange={setPosition}
              onZoomChange={setZoom}
              onCropComplete={(percentages) => setArea(percentages)}
              mediaProps={{ alt: imageName }}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <label htmlFor={`${id}-zoom`} className="flex flex-1 items-center gap-3 text-sm">
            <span className="shrink-0 text-[rgb(var(--color-text-600))]">
              {t('profile.imageUpload.zoom', 'Zoom')}
            </span>
            <input
              id={`${id}-zoom`}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[rgb(var(--color-primary-500))]"
              aria-valuetext={`${Math.round(zoom * 100)}%`}
            />
          </label>

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {t('profile.imageUpload.cropPreview', 'Preview')}
            </span>
            {PREVIEW_SIZES.map((size) => {
              const style = imageUrl ? previewStyle(size) : null;
              return (
                <span
                  key={size}
                  className="relative inline-block shrink-0 overflow-hidden rounded-full bg-[rgb(var(--color-border-200))]"
                  style={{ width: size, height: size }}
                  data-automation-id={`${id}-preview-${size}`}
                >
                  {style && <img src={imageUrl!} alt="" style={style} />}
                </span>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <div className="mt-4 flex justify-end gap-2">
            <Button id={`${id}-cancel`} variant="outline" onClick={onClose} disabled={isConfirming}>
              {tCore('common.cancel', 'Cancel')}
            </Button>
            <Button id={`${id}-confirm`} onClick={handleConfirm} disabled={!area || isConfirming}>
              {t('profile.imageUpload.applyCrop', 'Use this crop')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImageCropDialog;
