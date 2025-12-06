import Foundation
import AppKit
import CoreGraphics

/// Manages macOS permission requests for Screen Recording and Accessibility
///
/// On macOS, remote desktop functionality requires two permissions:
/// 1. Screen Recording - to capture screen content
/// 2. Accessibility - to inject mouse and keyboard events
///
/// These permissions must be granted by the user in System Preferences.
final class PermissionManager {
    /// Shared singleton instance
    static let shared = PermissionManager()

    private init() {}

    /// Check current permission status
    func checkPermissions() -> PermissionStatus {
        return PermissionStatus(
            screenRecording: checkScreenRecordingPermission(),
            accessibility: checkAccessibilityPermission()
        )
    }

    /// Check if screen recording permission is granted
    func checkScreenRecordingPermission() -> Bool {
        // CGPreflightScreenCaptureAccess() returns true if we have permission
        // On macOS 10.15+, this is required for screen capture
        if #available(macOS 10.15, *) {
            return CGPreflightScreenCaptureAccess()
        }
        return true // Pre-Catalina didn't require this permission
    }

    /// Check if accessibility permission is granted
    func checkAccessibilityPermission() -> Bool {
        // AXIsProcessTrusted() returns true if the app has accessibility permissions
        return AXIsProcessTrusted()
    }

    /// Request screen recording permission
    /// This triggers the system permission prompt if not already granted
    func requestScreenRecordingPermission() {
        if #available(macOS 10.15, *) {
            // CGRequestScreenCaptureAccess() triggers the permission prompt
            CGRequestScreenCaptureAccess()
        }
    }

    /// Request accessibility permission
    /// This opens System Preferences to the Accessibility pane
    func requestAccessibilityPermission() {
        // For accessibility, we can prompt the system dialog
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        AXIsProcessTrustedWithOptions(options)
    }

    /// Open System Preferences to the appropriate pane
    func openSystemPreferences() {
        let status = checkPermissions()

        if !status.screenRecording {
            // Open Screen Recording preferences
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
                NSWorkspace.shared.open(url)
            }
        } else if !status.accessibility {
            // Open Accessibility preferences
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    /// Start monitoring permission changes
    /// Returns when both permissions are granted
    func waitForPermissions() async -> Bool {
        // Poll for permission changes
        while true {
            let status = checkPermissions()
            if status.screenRecording && status.accessibility {
                return true
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        }
    }

    /// Show a dialog explaining why permissions are needed
    func showPermissionExplanation() {
        let alert = NSAlert()
        alert.messageText = "Permissions Required"
        alert.informativeText = """
        Remote Desktop Agent needs the following permissions:

        Screen Recording:
        Allows sharing your screen with remote technicians.

        Accessibility:
        Allows remote technicians to control your mouse and keyboard.

        These permissions ensure you can receive remote support when needed.
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Grant Permissions")
        alert.addButton(withTitle: "Not Now")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            requestAllPermissions()
        }
    }

    /// Request all required permissions
    func requestAllPermissions() {
        requestScreenRecordingPermission()
        requestAccessibilityPermission()
    }
}

/// Extension to provide a SwiftUI-compatible permission observer
extension PermissionManager {
    /// Creates a timer that periodically checks permission status
    func startPermissionMonitor(onChange: @escaping (PermissionStatus) -> Void) -> Timer {
        return Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let status = self.checkPermissions()
            DispatchQueue.main.async {
                onChange(status)
            }
        }
    }
}
