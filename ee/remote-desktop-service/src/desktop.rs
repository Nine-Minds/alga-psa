//! Desktop monitoring and input injection for Windows Service.
//!
//! This module handles:
//! - Desktop state detection (default, secure, winlogon)
//! - Session event monitoring (lock, unlock, logon, logoff)
//! - Input injection on secure desktops
//! - Monitor enumeration

use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::ipc::{
    DesktopStateResponse, DesktopType, InputEvent, MonitorInfo, MouseButton, SessionState,
    SpecialKeyCombo,
};
use crate::service::{ServiceCommand, SessionChangeEvent, SessionChangeType};

/// Desktop monitor for tracking session and desktop changes
pub struct DesktopMonitor {
    cmd_tx: mpsc::Sender<ServiceCommand>,
}

impl DesktopMonitor {
    /// Create a new desktop monitor
    pub fn new(cmd_tx: mpsc::Sender<ServiceCommand>) -> Self {
        Self { cmd_tx }
    }

    /// Start monitoring desktop changes
    pub async fn start(&self) -> Result<JoinHandle<()>> {
        let cmd_tx = self.cmd_tx.clone();

        let handle = tokio::task::spawn_blocking(move || {
            if let Err(e) = monitor_desktop_changes(cmd_tx) {
                error!("Desktop monitor error: {:?}", e);
            }
        });

        info!("Desktop monitor started");
        Ok(handle)
    }
}

/// Monitor for desktop switches and session changes
fn monitor_desktop_changes(cmd_tx: mpsc::Sender<ServiceCommand>) -> Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, TranslateMessage, MSG,
    };

    // Create a hidden window to receive messages
    // For now, we rely on service control handler for WTS_SESSION_* notifications

    // Poll for desktop changes periodically
    let mut last_desktop_type = DesktopType::Default;

    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Check current desktop type
        match detect_current_desktop() {
            Ok(current_type) => {
                if current_type != last_desktop_type {
                    info!(
                        "Desktop switched: {:?} -> {:?}",
                        last_desktop_type, current_type
                    );

                    // Note: The actual notification is sent via the pipe server
                    // This is just for logging purposes

                    last_desktop_type = current_type;
                }
            }
            Err(e) => {
                warn!("Failed to detect desktop type: {:?}", e);
            }
        }
    }
}

/// Detect the current desktop type
pub fn detect_current_desktop() -> Result<DesktopType> {
    use windows::Win32::System::StationsAndDesktops::{
        GetThreadDesktop, GetUserObjectInformationW, OpenInputDesktop, UOI_NAME,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;

    unsafe {
        // Try to open the input desktop
        let desktop = OpenInputDesktop(0, false, 0x0001 | 0x0002); // DESKTOP_READOBJECTS | DESKTOP_ENUMERATE

        let desktop_handle = match desktop {
            Ok(h) => h,
            Err(_) => {
                // Can't open input desktop - we're probably on the secure desktop
                return Ok(DesktopType::Secure);
            }
        };

        // Get the desktop name
        let mut name_buffer = vec![0u16; 256];
        let mut needed_size: u32 = 0;

        let result = GetUserObjectInformationW(
            desktop_handle,
            UOI_NAME,
            Some(name_buffer.as_mut_ptr() as *mut _),
            (name_buffer.len() * 2) as u32,
            Some(&mut needed_size),
        );

        if result.is_err() {
            return Ok(DesktopType::Unknown);
        }

        // Convert to string
        let name_len = name_buffer.iter().position(|&c| c == 0).unwrap_or(name_buffer.len());
        let desktop_name = String::from_utf16_lossy(&name_buffer[..name_len]);

        debug!("Current desktop: {}", desktop_name);

        // Determine desktop type based on name
        let desktop_type = match desktop_name.to_lowercase().as_str() {
            "default" => DesktopType::Default,
            "winlogon" => DesktopType::Winlogon,
            "screen-saver" => DesktopType::ScreenSaver,
            name if name.contains("secure") => DesktopType::Secure,
            _ => DesktopType::Default,
        };

        Ok(desktop_type)
    }
}

/// Get the current desktop state including session information and monitors
pub fn get_desktop_state() -> Result<DesktopStateResponse> {
    use windows::Win32::System::RemoteDesktop::{
        WTSEnumerateSessionsW, WTSFreeMemory, WTSGetActiveConsoleSessionId,
        WTSQuerySessionInformationW, WTS_CONNECTSTATE_CLASS, WTS_CURRENT_SERVER_HANDLE,
        WTS_SESSION_INFOW,
    };

    let desktop_type = detect_current_desktop().unwrap_or(DesktopType::Unknown);

    // Get active console session
    let console_session_id = unsafe { WTSGetActiveConsoleSessionId() };

    // Get session state
    let session_state = get_session_state(console_session_id)?;

    // Get user name
    let user_name = get_session_user(console_session_id).ok();

    // Check if locked
    let is_locked = session_state == SessionState::Locked
        || desktop_type == DesktopType::Winlogon
        || desktop_type == DesktopType::Secure;

    // Enumerate monitors
    let monitors = enumerate_monitors()?;

    Ok(DesktopStateResponse {
        desktop_type,
        is_locked,
        session_id: console_session_id,
        session_state,
        user_name,
        monitor_count: monitors.len() as u32,
        monitors,
    })
}

/// Get session state for a specific session ID
fn get_session_state(session_id: u32) -> Result<SessionState> {
    use windows::Win32::System::RemoteDesktop::{
        WTSConnectState, WTSQuerySessionInformationW, WTS_CONNECTSTATE_CLASS,
        WTS_CURRENT_SERVER_HANDLE,
    };

    unsafe {
        let mut buffer: *mut u8 = std::ptr::null_mut();
        let mut bytes_returned: u32 = 0;

        let result = WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            session_id,
            WTSConnectState,
            &mut buffer as *mut _ as *mut _,
            &mut bytes_returned,
        );

        if result.is_err() || buffer.is_null() {
            return Ok(SessionState::Unknown);
        }

        let state_value = *(buffer as *const i32);

        // Free the buffer
        windows::Win32::System::RemoteDesktop::WTSFreeMemory(buffer as *mut _);

        // Map WTS_CONNECTSTATE_CLASS to our SessionState
        let state = match state_value {
            0 => SessionState::Active,       // WTSActive
            1 => SessionState::Connected,    // WTSConnected
            2 => SessionState::Connected,    // WTSConnectQuery
            3 => SessionState::Shadow,       // WTSShadow
            4 => SessionState::Disconnected, // WTSDisconnected
            5 => SessionState::Active,       // WTSIdle
            6 => SessionState::WTSListen,    // WTSListen
            7 => SessionState::Reset,        // WTSReset
            8 => SessionState::Connected,    // WTSDown
            9 => SessionState::Connected,    // WTSInit
            _ => SessionState::Unknown,
        };

        Ok(state)
    }
}

/// Get the username for a session
fn get_session_user(session_id: u32) -> Result<String> {
    use windows::Win32::System::RemoteDesktop::{
        WTSQuerySessionInformationW, WTSUserName, WTS_CURRENT_SERVER_HANDLE,
    };

    unsafe {
        let mut buffer: *mut u16 = std::ptr::null_mut();
        let mut bytes_returned: u32 = 0;

        let result = WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            session_id,
            WTSUserName,
            &mut buffer as *mut _ as *mut _,
            &mut bytes_returned,
        );

        if result.is_err() || buffer.is_null() {
            return Err(anyhow::anyhow!("Failed to query session user"));
        }

        // Convert wide string to Rust string
        let len = (bytes_returned as usize / 2).saturating_sub(1);
        let slice = std::slice::from_raw_parts(buffer, len);
        let username = String::from_utf16_lossy(slice);

        // Free the buffer
        windows::Win32::System::RemoteDesktop::WTSFreeMemory(buffer as *mut _);

        Ok(username)
    }
}

/// Enumerate all monitors
fn enumerate_monitors() -> Result<Vec<MonitorInfo>> {
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR,
        MONITORINFOEXW,
    };
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};

    let mut monitors: Vec<MonitorInfo> = Vec::new();

    unsafe extern "system" fn enum_monitor_callback(
        monitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(data.0 as *mut Vec<MonitorInfo>);

        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        if GetMonitorInfoW(monitor, &mut info.monitorInfo as *mut _).as_bool() {
            let device_name: String = info
                .szDevice
                .iter()
                .take_while(|&&c| c != 0)
                .map(|&c| char::from_u32(c as u32).unwrap_or('?'))
                .collect();

            let rect = info.monitorInfo.rcMonitor;

            monitors.push(MonitorInfo {
                index: monitors.len() as u32,
                name: device_name,
                primary: (info.monitorInfo.dwFlags & 0x1) != 0, // MONITORINFOF_PRIMARY
                x: rect.left,
                y: rect.top,
                width: (rect.right - rect.left) as u32,
                height: (rect.bottom - rect.top) as u32,
                scale_factor: 1.0, // TODO: Get actual DPI
            });
        }

        BOOL(1) // Continue enumeration
    }

    unsafe {
        EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_monitor_callback),
            LPARAM(&mut monitors as *mut _ as isize),
        )
        .context("Failed to enumerate monitors")?;
    }

    Ok(monitors)
}

/// Inject input on the current desktop (including secure desktop)
pub fn inject_input(event: &InputEvent) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
        MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL,
        MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT, VIRTUAL_KEY,
    };

    match event {
        InputEvent::MouseMove { x, y, relative } => {
            let mut flags = MOUSEEVENTF_MOVE;
            let (abs_x, abs_y) = if *relative {
                (*x, *y)
            } else {
                flags |= MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                // Normalize to 0-65535 range
                let screen_width = unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CXVIRTUALSCREEN,
                    )
                };
                let screen_height = unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CYVIRTUALSCREEN,
                    )
                };
                let norm_x = (*x * 65535) / screen_width;
                let norm_y = (*y * 65535) / screen_height;
                (norm_x, norm_y)
            };

            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: abs_x,
                        dy: abs_y,
                        mouseData: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };

            unsafe {
                SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            }
        }

        InputEvent::MouseButton { button, pressed } => {
            let flags = match (button, pressed) {
                (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
                (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
                (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
                (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
                (MouseButton::X1, true) => MOUSEEVENTF_XDOWN,
                (MouseButton::X1, false) => MOUSEEVENTF_XUP,
                (MouseButton::X2, true) => MOUSEEVENTF_XDOWN,
                (MouseButton::X2, false) => MOUSEEVENTF_XUP,
            };

            let mouse_data = match button {
                MouseButton::X1 => 0x0001,
                MouseButton::X2 => 0x0002,
                _ => 0,
            };

            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: mouse_data,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };

            unsafe {
                SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            }
        }

        InputEvent::MouseWheel { delta_x, delta_y } => {
            if *delta_y != 0 {
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: (*delta_y * 120) as u32, // WHEEL_DELTA = 120
                            dwFlags: MOUSEEVENTF_WHEEL,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };

                unsafe {
                    SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
            }

            // Horizontal scroll
            if *delta_x != 0 {
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: (*delta_x * 120) as u32,
                            dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSEEVENTF_HWHEEL,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };

                unsafe {
                    SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
            }
        }

        InputEvent::Key {
            key_code,
            scan_code,
            pressed,
            extended,
        } => {
            let mut flags = KEYEVENTF_SCANCODE;
            if !*pressed {
                flags |= KEYEVENTF_KEYUP;
            }
            if *extended {
                flags |= KEYEVENTF_EXTENDEDKEY;
            }

            let input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(*key_code),
                        wScan: *scan_code,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };

            unsafe {
                SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            }
        }

        InputEvent::SpecialKeyCombination(combo) => {
            inject_special_key_combo(*combo)?;
        }
    }

    Ok(())
}

/// Inject a special key combination
fn inject_special_key_combo(combo: SpecialKeyCombo) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    let key_sequence: Vec<(u16, bool)> = match combo {
        SpecialKeyCombo::CtrlAltDel => {
            // Ctrl+Alt+Del requires special handling - use SAS (Secure Attention Sequence)
            // This only works from Session 0 running as SYSTEM
            inject_sas()?;
            return Ok(());
        }
        SpecialKeyCombo::WinL => {
            vec![
                (0x5B, true),  // Left Windows down
                (0x4C, true),  // L down
                (0x4C, false), // L up
                (0x5B, false), // Left Windows up
            ]
        }
        SpecialKeyCombo::AltTab => {
            vec![
                (0x12, true),  // Alt down
                (0x09, true),  // Tab down
                (0x09, false), // Tab up
                (0x12, false), // Alt up
            ]
        }
        SpecialKeyCombo::AltF4 => {
            vec![
                (0x12, true),  // Alt down
                (0x73, true),  // F4 down
                (0x73, false), // F4 up
                (0x12, false), // Alt up
            ]
        }
        SpecialKeyCombo::WinR => {
            vec![
                (0x5B, true),  // Left Windows down
                (0x52, true),  // R down
                (0x52, false), // R up
                (0x5B, false), // Left Windows up
            ]
        }
        SpecialKeyCombo::CtrlShiftEsc => {
            vec![
                (0x11, true),  // Ctrl down
                (0x10, true),  // Shift down
                (0x1B, true),  // Esc down
                (0x1B, false), // Esc up
                (0x10, false), // Shift up
                (0x11, false), // Ctrl up
            ]
        }
        SpecialKeyCombo::WinD => {
            vec![
                (0x5B, true),  // Left Windows down
                (0x44, true),  // D down
                (0x44, false), // D up
                (0x5B, false), // Left Windows up
            ]
        }
        SpecialKeyCombo::PrintScreen => {
            vec![
                (0x2C, true),  // PrintScreen down
                (0x2C, false), // PrintScreen up
            ]
        }
    };

    let inputs: Vec<INPUT> = key_sequence
        .iter()
        .map(|(vk, pressed)| {
            let mut flags = windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0);
            if !*pressed {
                flags |= KEYEVENTF_KEYUP;
            }
            // Extended keys (like Windows key)
            if *vk == 0x5B || *vk == 0x5C {
                flags |= KEYEVENTF_EXTENDEDKEY;
            }

            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(*vk),
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        })
        .collect();

    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }

    Ok(())
}

/// Inject Secure Attention Sequence (Ctrl+Alt+Del)
/// This requires the service to be running as SYSTEM in Session 0
fn inject_sas() -> Result<()> {
    // Try to use the SendSAS API if available (Windows Vista+)
    // This requires the process to run in Session 0 and have SE_TCB_NAME privilege

    // Load sas.dll dynamically
    use windows::core::PCSTR;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

    unsafe {
        let sas_dll = LoadLibraryA(PCSTR(b"sas.dll\0".as_ptr()));
        if let Ok(module) = sas_dll {
            let send_sas =
                GetProcAddress(module, PCSTR(b"SendSAS\0".as_ptr()));
            if let Some(func) = send_sas {
                // SendSAS(BOOL AsUser)
                let send_sas_fn: extern "system" fn(i32) = std::mem::transmute(func);
                send_sas_fn(0); // FALSE = send to Session 0
                return Ok(());
            }
        }
    }

    // Fallback: try to simulate Ctrl+Alt+Del directly (may not work on secure desktop)
    warn!("SendSAS not available, attempting direct key injection");

    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    let inputs = vec![
        // Ctrl down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x11), // VK_CONTROL
                    wScan: 0,
                    dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Alt down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x12), // VK_MENU
                    wScan: 0,
                    dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Delete down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x2E), // VK_DELETE
                    wScan: 0,
                    dwFlags: KEYEVENTF_EXTENDEDKEY,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Delete up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x2E), // VK_DELETE
                    wScan: 0,
                    dwFlags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Alt up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x12), // VK_MENU
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Ctrl up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x11), // VK_CONTROL
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_desktop_type_detection() {
        // This test would need to run on Windows
        // Just verify the function compiles for now
        let _ = detect_current_desktop();
    }
}
