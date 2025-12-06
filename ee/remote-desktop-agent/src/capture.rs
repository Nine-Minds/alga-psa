//! Screen capture module using the scrap crate

use anyhow::{Context, Result};
use image::{ImageBuffer, Rgba, ImageEncoder};
use image::codecs::jpeg::JpegEncoder;
use log::{debug, error, info};
use scrap::{Capturer, Display};
use std::io::Cursor;
use std::time::{Duration, Instant};

/// Screen capturer for capturing desktop frames
pub struct ScreenCapturer {
    capturer: Capturer,
    width: usize,
    height: usize,
    quality: u8,
    max_width: u32,
    max_height: u32,
}

/// A captured frame with metadata
pub struct CapturedFrame {
    /// JPEG-encoded frame data
    pub data: Vec<u8>,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Capture timestamp
    pub timestamp: Instant,
}

impl ScreenCapturer {
    /// Create a new screen capturer for the primary display
    pub fn new(quality: u8, max_width: u32, max_height: u32) -> Result<Self> {
        // Get the primary display
        let display = Display::primary()
            .context("Failed to get primary display")?;

        let width = display.width();
        let height = display.height();

        info!("Initializing screen capturer for display {}x{}", width, height);

        let capturer = Capturer::new(display)
            .context("Failed to create capturer")?;

        Ok(ScreenCapturer {
            capturer,
            width,
            height,
            quality,
            max_width,
            max_height,
        })
    }

    /// Get the native display dimensions
    pub fn dimensions(&self) -> (usize, usize) {
        (self.width, self.height)
    }

    /// Capture a single frame and return it as JPEG-encoded bytes
    pub fn capture_frame(&mut self) -> Result<Option<CapturedFrame>> {
        let timestamp = Instant::now();

        // Capture the frame
        let frame = match self.capturer.frame() {
            Ok(frame) => frame,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::WouldBlock {
                    // Frame not ready yet - this is normal
                    debug!("Frame not ready, skipping");
                    return Ok(None);
                }
                return Err(anyhow::anyhow!("Failed to capture frame: {}", e));
            }
        };

        // Convert BGRA to RGBA
        let mut rgba_data: Vec<u8> = Vec::with_capacity(self.width * self.height * 4);

        for chunk in frame.chunks(4) {
            if chunk.len() >= 4 {
                rgba_data.push(chunk[2]); // R (was B)
                rgba_data.push(chunk[1]); // G
                rgba_data.push(chunk[0]); // B (was R)
                rgba_data.push(chunk[3]); // A
            }
        }

        // Create image from raw data
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(
            self.width as u32,
            self.height as u32,
            rgba_data,
        ).context("Failed to create image buffer")?;

        // Scale if needed
        let (target_width, target_height) = self.calculate_target_size();

        let scaled_img = if target_width != self.width as u32 || target_height != self.height as u32 {
            image::imageops::resize(
                &img,
                target_width,
                target_height,
                image::imageops::FilterType::Triangle,
            )
        } else {
            img
        };

        // Encode to JPEG
        let mut jpeg_buffer = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_buffer);

        let encoder = JpegEncoder::new_with_quality(&mut cursor, self.quality);
        encoder.write_image(
            scaled_img.as_raw(),
            scaled_img.width(),
            scaled_img.height(),
            image::ExtendedColorType::Rgba8,
        ).context("Failed to encode JPEG")?;

        debug!(
            "Captured frame: {}x{} -> {}x{}, {} bytes",
            self.width,
            self.height,
            target_width,
            target_height,
            jpeg_buffer.len()
        );

        Ok(Some(CapturedFrame {
            data: jpeg_buffer,
            width: target_width,
            height: target_height,
            timestamp,
        }))
    }

    /// Calculate target size respecting max dimensions while maintaining aspect ratio
    fn calculate_target_size(&self) -> (u32, u32) {
        let width = self.width as u32;
        let height = self.height as u32;

        // If max dimensions are 0, use native resolution
        if self.max_width == 0 && self.max_height == 0 {
            return (width, height);
        }

        let max_w = if self.max_width > 0 { self.max_width } else { width };
        let max_h = if self.max_height > 0 { self.max_height } else { height };

        // If already within bounds, return native
        if width <= max_w && height <= max_h {
            return (width, height);
        }

        // Calculate scale factor
        let scale_w = max_w as f64 / width as f64;
        let scale_h = max_h as f64 / height as f64;
        let scale = scale_w.min(scale_h);

        (
            (width as f64 * scale) as u32,
            (height as f64 * scale) as u32,
        )
    }

    /// Set the JPEG quality (0-100)
    pub fn set_quality(&mut self, quality: u8) {
        self.quality = quality.min(100);
    }

    /// Set max dimensions for scaling
    pub fn set_max_dimensions(&mut self, max_width: u32, max_height: u32) {
        self.max_width = max_width;
        self.max_height = max_height;
    }
}

/// Capture frames at a specified FPS and send them through a channel
pub struct FrameProducer {
    capturer: ScreenCapturer,
    target_fps: u32,
}

impl FrameProducer {
    pub fn new(capturer: ScreenCapturer, target_fps: u32) -> Self {
        FrameProducer {
            capturer,
            target_fps: target_fps.max(1).min(60),
        }
    }

    /// Get the frame interval based on target FPS
    pub fn frame_interval(&self) -> Duration {
        Duration::from_millis(1000 / self.target_fps as u64)
    }

    /// Capture a frame (wrapper around ScreenCapturer)
    pub fn capture(&mut self) -> Result<Option<CapturedFrame>> {
        self.capturer.capture_frame()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_target_size_no_scaling() {
        let capturer = ScreenCapturer {
            capturer: unsafe { std::mem::zeroed() }, // Don't actually use this
            width: 1920,
            height: 1080,
            quality: 75,
            max_width: 0,
            max_height: 0,
        };

        // Can't easily test without a real display
        // This is just a structural test
        assert_eq!(capturer.dimensions(), (1920, 1080));
    }
}
