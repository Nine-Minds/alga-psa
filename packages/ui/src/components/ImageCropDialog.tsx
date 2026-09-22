'use client';

import * as React from 'react';
import Cropper, { type Area, type MediaSize, type Size } from 'react-easy-crop';
import type { LogoCropRect } from '@alga-psa/types';
import { Minus, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from './Dialog';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';

// Below 1x the mark gets transparent space around it, so a symbol sitting on
// the edge of a wordmark can still be centred in the circle.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
// One click of the - / + buttons; the slider itself is continuous.
const ZOOM_STEP = 0.1;

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
 * Keeps the image and the crop window overlapping by at least half of whichever
 * is smaller on each axis: the window may hang past the image's edge (the
 * server pads that with transparency), but the image can never leave it.
 */
const clampPosition = (
  position: { x: number; y: number },
  zoom: number,
  media: MediaSize | null,
  cropSize: Size | null,
): { x: number; y: number } => {
  if (!media || !cropSize) return position;
  const limit = (extent: number, window: number) => {
    const scaled = extent * zoom;
    return (scaled + window) / 2 - Math.min(scaled, window) / 2;
  };
  const maxX = limit(media.width, cropSize.width);
  const maxY = limit(media.height, cropSize.height);
  return {
    x: Math.min(Math.max(position.x, -maxX), maxX),
    y: Math.min(Math.max(position.y, -maxY), maxY),
  };
};

/**
 * Picks the square zone of a wide logo that avatar-sized slots will show. The
 * image covers a fixed-height stage and the round window stays put, so the user
 * drags the wordmark under it and zooms in on the part that reads as a mark, or
 * out to leave space around it. Returns fractions of the source image, never
 * pixels; a zone that reaches past the image is cut with transparent padding.
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
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState<Area | null>(null);
  const [media, setMedia] = React.useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = React.useState<Size | null>(null);
  const crop = clampPosition(position, zoom, media, cropSize);

  // Every open starts centred at 1x; a stale offset from another image would land off-canvas.
  React.useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      setZoom(1);
      setArea(null);
      setMedia(null);
    }
  }, [isOpen, imageUrl]);

  // Rounded to the step so repeated clicks land on clean values (0.9, 1, 1.1...).
  const stepZoom = (delta: number) =>
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + delta) * 100) / 100)));

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
            'Drag the logo and zoom to pick the part shown in small, square spaces. Zoom out to leave space around it. The full logo is kept as well.'
          )}
        </DialogDescription>

        <div
          className="relative mt-4 h-64 w-full overflow-hidden rounded-md bg-[rgb(var(--color-border-100))]"
          data-automation-id={`${id}-stage`}
        >
          {imageUrl && (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              objectFit="cover"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              restrictPosition={false}
              onCropChange={setPosition}
              onZoomChange={setZoom}
              onMediaLoaded={setMedia}
              onCropSizeChange={setCropSize}
              onCropComplete={(percentages) => setArea(percentages)}
              mediaProps={{ alt: imageName }}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div className="flex flex-1 items-center gap-2 text-sm">
            <label htmlFor={`${id}-zoom`} className="shrink-0 text-[rgb(var(--color-text-600))]">
              {t('profile.imageUpload.zoom', 'Zoom')}
            </label>
            <Button
              id={`${id}-zoom-out`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => stepZoom(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              aria-label={t('profile.imageUpload.zoomOut', 'Zoom out')}
              className="h-7 w-7 shrink-0 p-0"
            >
              <Minus className="h-4 w-4" />
            </Button>
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
            <Button
              id={`${id}-zoom-in`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => stepZoom(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              aria-label={t('profile.imageUpload.zoomIn', 'Zoom in')}
              className="h-7 w-7 shrink-0 p-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

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
