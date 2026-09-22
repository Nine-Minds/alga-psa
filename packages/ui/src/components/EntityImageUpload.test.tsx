/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EntityImageUpload from './EntityImageUpload';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// jsdom has no layout, so the real cropper never reports an area. This stand-in
// reports the zone a user would have picked: 10% in, a full-height square of a 4:1 image.
vi.mock('react-easy-crop', () => {
  const MockCropper = (props: { onCropComplete?: (a: unknown, b: unknown) => void }) => {
    React.useEffect(() => {
      props.onCropComplete?.({ x: 10, y: 0, width: 25, height: 100 }, { x: 100, y: 0, width: 250, height: 250 });
    }, []);
    return <div data-testid="cropper" />;
  };
  return { default: MockCropper };
});

// jsdom never decodes images: the probe's natural size comes from this stub
// and its load event is dispatched by hand on the last Image constructed.
let probeSize = { width: 0, height: 0 };
const createdImages: HTMLImageElement[] = [];
const OriginalImage = globalThis.Image;
const originalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');

beforeEach(() => {
  createdImages.length = 0;
  globalThis.Image = class extends OriginalImage {
    constructor() {
      super();
      createdImages.push(this);
    }
  } as typeof Image;
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => probeSize.width });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => probeSize.height });
});

afterEach(() => {
  cleanup();
  globalThis.Image = OriginalImage;
  if (originalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalWidth);
  if (originalHeight) Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalHeight);
});

type Props = Partial<React.ComponentProps<typeof EntityImageUpload>>;

const renderUpload = (previewShape: 'circle' | 'auto', props: Props = {}) =>
  render(
    <EntityImageUpload
      entityType="client"
      entityId="client-1"
      entityName="Lotrasoft Inc."
      imageUrl="/api/documents/view/logo-1"
      uploadAction={vi.fn()}
      deleteAction={vi.fn()}
      size="md"
      previewShape={previewShape}
      {...props}
    />
  );

const pickFile = async (file: File, bitmap: { width: number; height: number }) => {
  (globalThis as any).createImageBitmap = vi.fn(async () => ({ ...bitmap, close: vi.fn() }));
  (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:picked');
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: /edit client image/i }));
  const input = document.querySelector('[data-automation-id="client-image-file-input"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

const cropDialog = () => document.querySelector('[data-automation-id="client-image-crop-dialog-stage"]');

const resolveProbe = async (width: number, height: number) => {
  probeSize = { width, height };
  await act(async () => {
    createdImages.at(-1)!.dispatchEvent(new Event('load'));
  });
};

const widePreview = () => document.querySelector('[data-automation-id="client-image-wide-preview"]');

describe('EntityImageUpload auto preview', () => {
  it('renders a wide logo contained at the avatar height instead of cover-cropping it', async () => {
    renderUpload('auto');
    // Initials avatar until the probe resolves.
    expect(screen.getByText('LI')).toBeTruthy();
    expect(widePreview()).toBeNull();

    await resolveProbe(1000, 250);

    const wide = widePreview() as HTMLImageElement;
    expect(wide).toBeTruthy();
    expect(wide.className).toContain('object-contain');
    expect(wide.className).toContain('h-10');
    expect(screen.queryByText('LI')).toBeNull();
  });

  it('keeps the circle avatar for a square logo', async () => {
    renderUpload('auto');
    await resolveProbe(512, 512);
    expect(widePreview()).toBeNull();
    expect(screen.getByRole('img', { hidden: true }).className).toContain('object-cover');
  });

  it('never probes in the default circle mode', () => {
    renderUpload('circle');
    expect(createdImages).toHaveLength(0);
  });
});

describe('EntityImageUpload wide variant', () => {
  it('renders a known wide logo in the auto slot without probing', () => {
    renderUpload('auto', { wideImageUrl: '/api/documents/view/logo-wide' });
    const wide = widePreview() as HTMLImageElement;
    expect(wide).toBeTruthy();
    expect(wide.getAttribute('src')).toBe('/api/documents/view/logo-wide');
    expect(createdImages).toHaveLength(0);
  });
});

describe('EntityImageUpload crop on upload', () => {
  const png = () => new File(['png'], 'Logo.png', { type: 'image/png' });

  it('opens the crop dialog for a wide image and uploads the chosen zone', async () => {
    const uploadAction = vi.fn(async (_id: string, _formData: FormData) => ({ success: true, imageUrl: '/api/documents/view/mark', wideImageUrl: '/api/documents/view/wide' }));
    const onImageChange = vi.fn();
    renderUpload('circle', { cropWideToSquare: true, uploadAction, onImageChange });

    await pickFile(png(), { width: 1000, height: 250 });

    expect(cropDialog()).toBeTruthy();
    expect(uploadAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));
    });

    await waitFor(() => expect(uploadAction).toHaveBeenCalledTimes(1));
    const formData = uploadAction.mock.calls[0][1];
    expect((formData.get('logo') as File).name).toBe('Logo.png');
    expect(JSON.parse(formData.get('crop') as string)).toEqual({ x: 0.1, y: 0, width: 0.25, height: 1 });
    await waitFor(() => expect(onImageChange).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/documents/view/mark?t='),
      expect.stringContaining('/api/documents/view/wide?t='),
    ));
  });

  it('uploads a square image straight away, with no crop field', async () => {
    const uploadAction = vi.fn(async (_id: string, _formData: FormData) => ({ success: true, imageUrl: '/api/documents/view/mark', wideImageUrl: null }));
    renderUpload('circle', { cropWideToSquare: true, uploadAction });

    await pickFile(png(), { width: 512, height: 512 });

    expect(cropDialog()).toBeNull();
    await waitFor(() => expect(uploadAction).toHaveBeenCalledTimes(1));
    expect(uploadAction.mock.calls[0][1].get('crop')).toBeNull();
  });

  it('cancelling the dialog drops the file and clears the input', async () => {
    const uploadAction = vi.fn();
    renderUpload('circle', { cropWideToSquare: true, uploadAction });

    await pickFile(png(), { width: 1000, height: 250 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cropDialog()).toBeNull();
    expect(uploadAction).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picked');
  });
});

describe('EntityImageUpload adjust mark', () => {
  it('re-cuts the mark from the stored wide logo', async () => {
    const recropAction = vi.fn(async () => ({ success: true, imageUrl: '/api/documents/view/mark-2' }));
    const onImageChange = vi.fn();
    renderUpload('circle', { wideImageUrl: '/api/documents/view/wide', recropAction, onImageChange });

    fireEvent.click(screen.getByRole('button', { name: /edit client image/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Adjust mark' }));
    expect(cropDialog()).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));
    });

    await waitFor(() => expect(recropAction).toHaveBeenCalledWith('client-1', { x: 0.1, y: 0, width: 0.25, height: 1 }));
    await waitFor(() => expect(onImageChange).toHaveBeenCalledWith(
      expect.stringContaining('/api/documents/view/mark-2?t='),
      '/api/documents/view/wide',
    ));
  });

  it('offers the button only when there is a wide logo to cut from', () => {
    renderUpload('circle', { recropAction: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /edit client image/i }));
    expect(screen.queryByRole('button', { name: 'Adjust mark' })).toBeNull();
  });
});
