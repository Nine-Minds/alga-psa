//! Input injection module for mouse and keyboard control

use anyhow::{Context, Result};
use enigo::{Enigo, Keyboard, Mouse, Settings, Key, Button, Coordinate, Direction};
use log::debug;
use serde::{Deserialize, Serialize};

/// Input event types received from the browser client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InputEvent {
    MouseMove { x: i32, y: i32 },
    MouseDown { button: String },
    MouseUp { button: String },
    MouseScroll { delta_x: i32, delta_y: i32 },
    KeyDown { key: String },
    KeyUp { key: String },
}

/// Input controller for injecting mouse and keyboard events
pub struct InputController {
    enigo: Enigo,
}

impl InputController {
    /// Create a new input controller
    pub fn new() -> Result<Self> {
        let settings = Settings::default();
        let enigo = Enigo::new(&settings)
            .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;

        Ok(InputController { enigo })
    }

    /// Handle an input event
    pub fn handle_event(&mut self, event: InputEvent) -> Result<()> {
        debug!("Handling input event: {:?}", event);

        match event {
            InputEvent::MouseMove { x, y } => {
                self.enigo.move_mouse(x, y, Coordinate::Abs)
                    .map_err(|e| anyhow::anyhow!("Failed to move mouse: {:?}", e))?;
            }
            InputEvent::MouseDown { button } => {
                let mouse_btn = self.parse_mouse_button(&button)?;
                self.enigo.button(mouse_btn, Direction::Press)
                    .map_err(|e| anyhow::anyhow!("Failed to press mouse button: {:?}", e))?;
            }
            InputEvent::MouseUp { button } => {
                let mouse_btn = self.parse_mouse_button(&button)?;
                self.enigo.button(mouse_btn, Direction::Release)
                    .map_err(|e| anyhow::anyhow!("Failed to release mouse button: {:?}", e))?;
            }
            InputEvent::MouseScroll { delta_x: _, delta_y } => {
                // Enigo uses positive = up, browser uses positive = down
                // Scrolling in discrete units
                let scroll_amount = if delta_y.abs() > 0 {
                    if delta_y > 0 { -3 } else { 3 }
                } else {
                    0
                };
                if scroll_amount != 0 {
                    self.enigo.scroll(scroll_amount, enigo::Axis::Vertical)
                        .map_err(|e| anyhow::anyhow!("Failed to scroll: {:?}", e))?;
                }
            }
            InputEvent::KeyDown { key } => {
                let key_code = self.parse_key(&key)?;
                self.enigo.key(key_code, Direction::Press)
                    .map_err(|e| anyhow::anyhow!("Failed to press key: {:?}", e))?;
            }
            InputEvent::KeyUp { key } => {
                let key_code = self.parse_key(&key)?;
                self.enigo.key(key_code, Direction::Release)
                    .map_err(|e| anyhow::anyhow!("Failed to release key: {:?}", e))?;
            }
        }

        Ok(())
    }

    /// Parse mouse button string to Enigo Button
    fn parse_mouse_button(&self, button: &str) -> Result<Button> {
        match button.to_lowercase().as_str() {
            "left" => Ok(Button::Left),
            "right" => Ok(Button::Right),
            "middle" => Ok(Button::Middle),
            _ => Err(anyhow::anyhow!("Unknown mouse button: {}", button)),
        }
    }

    /// Parse key string to Enigo Key
    fn parse_key(&self, key: &str) -> Result<Key> {
        // Map common key names from browser KeyboardEvent.key to Enigo keys
        let key = match key {
            // Special keys
            "Enter" => Key::Return,
            "Backspace" => Key::Backspace,
            "Tab" => Key::Tab,
            "Escape" => Key::Escape,
            " " | "Space" => Key::Space,
            "Delete" => Key::Delete,
            "Home" => Key::Home,
            "End" => Key::End,
            "PageUp" => Key::PageUp,
            "PageDown" => Key::PageDown,
            "Insert" => Key::Other(0x2D), // VK_INSERT on Windows

            // Arrow keys
            "ArrowLeft" => Key::LeftArrow,
            "ArrowRight" => Key::RightArrow,
            "ArrowUp" => Key::UpArrow,
            "ArrowDown" => Key::DownArrow,

            // Modifier keys
            "Control" | "ControlLeft" | "ControlRight" => Key::Control,
            "Shift" | "ShiftLeft" | "ShiftRight" => Key::Shift,
            "Alt" | "AltLeft" | "AltRight" => Key::Alt,
            "Meta" | "MetaLeft" | "MetaRight" => Key::Meta,
            "CapsLock" => Key::CapsLock,

            // Function keys
            "F1" => Key::F1,
            "F2" => Key::F2,
            "F3" => Key::F3,
            "F4" => Key::F4,
            "F5" => Key::F5,
            "F6" => Key::F6,
            "F7" => Key::F7,
            "F8" => Key::F8,
            "F9" => Key::F9,
            "F10" => Key::F10,
            "F11" => Key::F11,
            "F12" => Key::F12,

            // Single character keys
            s if s.len() == 1 => {
                let c = s.chars().next().unwrap();
                Key::Unicode(c)
            }

            // Unknown keys - try to handle them gracefully
            _ => {
                log::warn!("Unknown key: {}", key);
                return Err(anyhow::anyhow!("Unknown key: {}", key));
            }
        };

        Ok(key)
    }

    /// Perform a mouse click at the specified position
    pub fn click_at(&mut self, x: i32, y: i32, button: Button) -> Result<()> {
        self.enigo.move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| anyhow::anyhow!("Failed to move mouse: {:?}", e))?;
        self.enigo.button(button, Direction::Click)
            .map_err(|e| anyhow::anyhow!("Failed to click: {:?}", e))?;
        Ok(())
    }

    /// Type a string of text
    pub fn type_text(&mut self, text: &str) -> Result<()> {
        self.enigo.text(text)
            .map_err(|e| anyhow::anyhow!("Failed to type text: {:?}", e))?;
        Ok(())
    }
}

impl Default for InputController {
    fn default() -> Self {
        Self::new().expect("Failed to create InputController")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mouse_button() {
        let controller = InputController::new().unwrap();

        assert!(matches!(controller.parse_mouse_button("left"), Ok(Button::Left)));
        assert!(matches!(controller.parse_mouse_button("right"), Ok(Button::Right)));
        assert!(matches!(controller.parse_mouse_button("middle"), Ok(Button::Middle)));
        assert!(controller.parse_mouse_button("invalid").is_err());
    }

    #[test]
    fn test_parse_key() {
        let controller = InputController::new().unwrap();

        assert!(matches!(controller.parse_key("Enter"), Ok(Key::Return)));
        assert!(matches!(controller.parse_key("Tab"), Ok(Key::Tab)));
        assert!(matches!(controller.parse_key("a"), Ok(Key::Unicode('a'))));
    }
}
