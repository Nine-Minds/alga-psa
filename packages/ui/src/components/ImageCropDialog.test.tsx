/** @vitest-environment jsdom */

import React from 'react';
import type { MediaSize, Size } from 'react-easy-crop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ImageCropDialog, clampPosition } from './ImageCropDialog';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

type CropperProps = {
  crop: { x: number; y: number };
  onCropChange: (position: { x: number; y: number }) => void;
  setMediaSize?: (size: MediaSize) => void;
  onMediaLoaded?: (size: MediaSize) => void;
  onCropSizeChange?: (size: Size) => void;
};

// Captures every render's props so the test can both call the cropper's
// callbacks and read back the `crop` the dialog feeds it.
const renders: CropperProps[] = [];

vi.mock('react-easy-crop', () => ({
  default: (props: CropperProps) => {
    renders.push(props);
    return <div data-testid="cropper" />;
  },
}));

// A 1400x256 wordmark drawn to cover the 256-high stage: the size the user drags.
const COVER_MEDIA: MediaSize = { width: 1400, height: 256, naturalWidth: 1400, naturalHeight: 256 };
// What onMediaLoaded reported instead - the contain fit measured before the cover pass.
const CONTAIN_MEDIA: MediaSize = { width: 622, height: 114, naturalWidth: 1400, naturalHeight: 256 };
const CROP_SIZE: Size = { width: 256, height: 256 };

const last = () => renders[renders.length - 1];

afterEach(() => {
  cleanup();
  renders.length = 0;
});

describe('clampPosition', () => {
  it('lets the wordmark travel its full width past the window', () => {
    // (1400 + 256) / 2 - 256 / 2
    expect(clampPosition({ x: 5000, y: 0 }, 1, COVER_MEDIA, CROP_SIZE).x).toBe(700);
    expect(clampPosition({ x: -5000, y: 0 }, 1, COVER_MEDIA, CROP_SIZE).x).toBe(-700);
    expect(clampPosition({ x: 420, y: 0 }, 1, COVER_MEDIA, CROP_SIZE).x).toBe(420);
  });

  it('stopped the drag less than halfway when fed the contain size', () => {
    // The regression: 311 of the 700px of travel, so the right end of a wide
    // logo could never be dragged under the circle.
    expect(clampPosition({ x: 5000, y: 0 }, 1, CONTAIN_MEDIA, CROP_SIZE).x).toBe(311);
  });

  it('grows the range with zoom and leaves the axes independent', () => {
    // (2800 + 256) / 2 - 256 / 2
    expect(clampPosition({ x: 5000, y: 0 }, 2, COVER_MEDIA, CROP_SIZE).x).toBe(1400);
    expect(clampPosition({ x: 0, y: 5000 }, 1, COVER_MEDIA, CROP_SIZE).y).toBe(128);
  });

  it('passes the position through until both sizes are known', () => {
    expect(clampPosition({ x: 5000, y: 0 }, 1, null, CROP_SIZE).x).toBe(5000);
    expect(clampPosition({ x: 5000, y: 0 }, 1, COVER_MEDIA, null).x).toBe(5000);
  });
});

describe('ImageCropDialog', () => {
  const renderDialog = () =>
    render(
      <ImageCropDialog
        isOpen
        imageUrl="blob:logo"
        imageName="Lotrasoft Inc."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

  const reportSizes = (media: MediaSize) =>
    act(() => {
      last().setMediaSize?.(media);
      last().onCropSizeChange?.(CROP_SIZE);
    });

  it('clamps a drag to the size the media is drawn at', () => {
    renderDialog();
    reportSizes(COVER_MEDIA);

    act(() => last().onCropChange({ x: 900, y: 0 }));
    expect(last().crop).toEqual({ x: 700, y: 0 });

    act(() => last().onCropChange({ x: -900, y: 0 }));
    expect(last().crop).toEqual({ x: -700, y: 0 });
  });

  it('takes the cover-drawn size from setMediaSize, not onMediaLoaded', () => {
    renderDialog();
    // The load-time callback is no longer wired up, so a contain-sized report
    // through it must not narrow the drag range.
    act(() => last().onMediaLoaded?.(CONTAIN_MEDIA));
    reportSizes(COVER_MEDIA);

    act(() => last().onCropChange({ x: 900, y: 0 }));
    expect(last().crop.x).toBe(700);
    expect(last().crop.x).not.toBe(311);
  });

  it('re-clamps when a resize reports a smaller drawn size', () => {
    renderDialog();
    reportSizes(COVER_MEDIA);
    act(() => last().onCropChange({ x: 900, y: 0 }));

    act(() => last().setMediaSize?.({ ...COVER_MEDIA, width: 700, height: 128 }));
    // (700 + 256) / 2 - 256 / 2
    expect(last().crop.x).toBe(350);
  });
});
