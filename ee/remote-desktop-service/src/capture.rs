//! Secure Desktop Screen Capture for Windows Service.
//!
//! This module handles screen capture from Session 0, which has access to:
//! - Secure Desktop (UAC prompts)
//! - Winlogon Desktop (login screen)
//! - Lock screen
//!
//! It uses Desktop Duplication API (DDA) for efficient capture when available,
//! falling back to GDI for compatibility.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use tracing::{debug, error, info, warn};

use crate::ipc::{FrameData, ImageFormat, StartCaptureConfig};

/// Secure desktop screen capture
pub struct SecureDesktopCapture {
    /// Whether continuous capture is active
    capturing: Arc<AtomicBool>,
    /// Capture configuration
    config: std::sync::Mutex<Option<StartCaptureConfig>>,
}

impl SecureDesktopCapture {
    /// Create a new secure desktop capture instance
    pub fn new() -> Result<Self> {
        Ok(Self {
            capturing: Arc::new(AtomicBool::new(false)),
            config: std::sync::Mutex::new(None),
        })
    }

    /// Capture a single frame from the specified monitor
    pub fn capture_frame(&self, monitor_index: u32, quality: u8) -> Result<FrameData> {
        // Try DDA first, fall back to GDI
        match self.capture_dda(monitor_index) {
            Ok(raw_frame) => self.encode_frame(raw_frame, quality),
            Err(e) => {
                debug!("DDA capture failed ({}), falling back to GDI", e);
                let raw_frame = self.capture_gdi(monitor_index)?;
                self.encode_frame(raw_frame, quality)
            }
        }
    }

    /// Start continuous frame capture
    pub fn start_capture(&self, config: StartCaptureConfig) -> Result<()> {
        if self.capturing.load(Ordering::SeqCst) {
            return Err(anyhow::anyhow!("Capture already in progress"));
        }

        *self.config.lock().unwrap() = Some(config);
        self.capturing.store(true, Ordering::SeqCst);

        info!("Started continuous capture");
        Ok(())
    }

    /// Stop continuous frame capture
    pub fn stop_capture(&self) {
        self.capturing.store(false, Ordering::SeqCst);
        *self.config.lock().unwrap() = None;
        info!("Stopped continuous capture");
    }

    /// Check if continuous capture is active
    pub fn is_capturing(&self) -> bool {
        self.capturing.load(Ordering::SeqCst)
    }

    /// Capture using Desktop Duplication API (more efficient)
    fn capture_dda(&self, monitor_index: u32) -> Result<RawFrame> {
        use windows::Win32::Graphics::Dxgi::{
            CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1,
            IDXGISurface1, DXGI_MAP_READ, DXGI_OUTPUT_DESC, DXGI_OUTDUPL_FRAME_INFO,
        };
        use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CPU_ACCESS_READ, D3D11_SDK_VERSION,
            D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
        };
        use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
        use windows::core::Interface;

        unsafe {
            // Create DXGI factory
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;

            // Get adapter (GPU)
            let adapter: IDXGIAdapter1 = factory.EnumAdapters1(0)?;

            // Create D3D11 device
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;

            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_HARDWARE,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;

            let device = device.context("Failed to create D3D11 device")?;
            let context = context.context("Failed to get D3D11 context")?;

            // Get output (monitor)
            let output: IDXGIOutput = adapter.EnumOutputs(monitor_index)?;
            let output1: IDXGIOutput1 = output.cast()?;

            // Get output description for dimensions
            let mut output_desc = DXGI_OUTPUT_DESC::default();
            output.GetDesc(&mut output_desc)?;

            let width = (output_desc.DesktopCoordinates.right
                - output_desc.DesktopCoordinates.left) as u32;
            let height = (output_desc.DesktopCoordinates.bottom
                - output_desc.DesktopCoordinates.top) as u32;

            // Create output duplication
            let duplication = output1.DuplicateOutput(&device)?;

            // Acquire frame
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut desktop_resource = None;

            // Try to acquire with timeout
            let result = duplication.AcquireNextFrame(100, &mut frame_info, &mut desktop_resource);

            if result.is_err() {
                return Err(anyhow::anyhow!(
                    "Failed to acquire frame (desktop may be switching)"
                ));
            }

            let desktop_resource = desktop_resource.context("No desktop resource")?;

            // Get texture from resource
            let desktop_texture: ID3D11Texture2D = desktop_resource.cast()?;

            // Create staging texture for CPU access
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            desktop_texture.GetDesc(&mut desc);

            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = windows::Win32::Graphics::Direct3D11::D3D11_BIND_FLAG(0);
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
            desc.MiscFlags = windows::Win32::Graphics::Direct3D11::D3D11_RESOURCE_MISC_FLAG(0);

            let staging_texture = device.CreateTexture2D(&desc, None)?;

            // Copy to staging texture
            context.CopyResource(&staging_texture, &desktop_texture);

            // Map the staging texture
            let mut mapped = windows::Win32::Graphics::Direct3D11::D3D11_MAPPED_SUBRESOURCE::default();
            context.Map(
                &staging_texture,
                0,
                windows::Win32::Graphics::Direct3D11::D3D11_MAP_READ,
                0,
                Some(&mut mapped),
            )?;

            // Copy pixel data
            let row_pitch = mapped.RowPitch as usize;
            let data_size = row_pitch * height as usize;
            let mut pixels = vec![0u8; (width * height * 4) as usize];

            let src_ptr = mapped.pData as *const u8;
            for y in 0..height as usize {
                let src_row = src_ptr.add(y * row_pitch);
                let dst_row = &mut pixels[y * (width as usize * 4)..(y + 1) * (width as usize * 4)];
                std::ptr::copy_nonoverlapping(src_row, dst_row.as_mut_ptr(), width as usize * 4);
            }

            // Unmap
            context.Unmap(&staging_texture, 0);

            // Release frame
            duplication.ReleaseFrame()?;

            Ok(RawFrame {
                width,
                height,
                pixels,
                format: PixelFormat::Bgra,
            })
        }
    }

    /// Capture using GDI (fallback, works on secure desktop)
    fn capture_gdi(&self, monitor_index: u32) -> Result<RawFrame> {
        use windows::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
            GetDIBits, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            SRCCOPY,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetDesktopWindow, GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        };
        use windows::Win32::Foundation::HWND;

        unsafe {
            // Get screen dimensions
            let width = GetSystemMetrics(SM_CXSCREEN) as u32;
            let height = GetSystemMetrics(SM_CYSCREEN) as u32;

            if width == 0 || height == 0 {
                return Err(anyhow::anyhow!("Failed to get screen dimensions"));
            }

            // Get desktop DC
            let desktop_hwnd = GetDesktopWindow();
            let desktop_dc =
                windows::Win32::Graphics::Gdi::GetDC(desktop_hwnd);

            if desktop_dc.is_invalid() {
                return Err(anyhow::anyhow!("Failed to get desktop DC"));
            }

            // Create compatible DC and bitmap
            let mem_dc = CreateCompatibleDC(desktop_dc);
            if mem_dc.is_invalid() {
                windows::Win32::Graphics::Gdi::ReleaseDC(desktop_hwnd, desktop_dc);
                return Err(anyhow::anyhow!("Failed to create compatible DC"));
            }

            let bitmap = CreateCompatibleBitmap(desktop_dc, width as i32, height as i32);
            if bitmap.is_invalid() {
                DeleteDC(mem_dc);
                windows::Win32::Graphics::Gdi::ReleaseDC(desktop_hwnd, desktop_dc);
                return Err(anyhow::anyhow!("Failed to create bitmap"));
            }

            // Select bitmap into DC
            let old_bitmap = SelectObject(mem_dc, bitmap);

            // BitBlt from desktop to memory DC
            BitBlt(
                mem_dc,
                0,
                0,
                width as i32,
                height as i32,
                desktop_dc,
                0,
                0,
                SRCCOPY,
            )?;

            // Prepare bitmap info
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32), // Negative for top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0 as u32,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default()],
            };

            // Allocate pixel buffer
            let mut pixels = vec![0u8; (width * height * 4) as usize];

            // Get DIB bits
            let result = GetDIBits(
                mem_dc,
                bitmap,
                0,
                height,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bi,
                DIB_RGB_COLORS,
            );

            // Clean up
            SelectObject(mem_dc, old_bitmap);
            DeleteObject(bitmap);
            DeleteDC(mem_dc);
            windows::Win32::Graphics::Gdi::ReleaseDC(desktop_hwnd, desktop_dc);

            if result == 0 {
                return Err(anyhow::anyhow!("Failed to get DIB bits"));
            }

            Ok(RawFrame {
                width,
                height,
                pixels,
                format: PixelFormat::Bgra,
            })
        }
    }

    /// Encode raw frame to JPEG
    fn encode_frame(&self, raw: RawFrame, quality: u8) -> Result<FrameData> {
        use image::{ImageBuffer, Rgba};

        // Convert BGRA to RGBA
        let mut rgba_pixels = raw.pixels.clone();
        for chunk in rgba_pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // Swap B and R
        }

        // Create image buffer
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(raw.width, raw.height, rgba_pixels)
                .context("Failed to create image buffer")?;

        // Encode to JPEG
        let mut jpeg_buffer = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut jpeg_buffer,
            quality.clamp(1, 100),
        );
        encoder
            .encode_image(&img)
            .context("Failed to encode JPEG")?;

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Ok(FrameData {
            width: raw.width,
            height: raw.height,
            format: ImageFormat::Jpeg,
            data: jpeg_buffer,
            timestamp_ms,
            monitor_index: 0,
        })
    }
}

/// Raw frame data before encoding
struct RawFrame {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
    format: PixelFormat,
}

/// Pixel format
#[derive(Debug, Clone, Copy)]
enum PixelFormat {
    Bgra,
    Rgba,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_creation() {
        // Just verify it compiles
        let _ = SecureDesktopCapture::new();
    }
}
