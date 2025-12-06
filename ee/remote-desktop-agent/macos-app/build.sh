#!/bin/bash
#
# Build script for Remote Desktop Agent (macOS)
#
# This script builds both the Rust library and Swift application,
# creating a universal binary that supports both Intel and Apple Silicon.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
RELEASE_DIR="$SCRIPT_DIR/release"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for required tools
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v rustup &> /dev/null; then
        log_error "rustup is not installed. Please install Rust."
        exit 1
    fi

    if ! command -v cargo &> /dev/null; then
        log_error "cargo is not installed. Please install Rust."
        exit 1
    fi

    if ! command -v swift &> /dev/null; then
        log_error "swift is not installed. Please install Xcode."
        exit 1
    fi

    # Ensure we have the macOS targets
    rustup target add x86_64-apple-darwin 2>/dev/null || true
    rustup target add aarch64-apple-darwin 2>/dev/null || true

    log_info "Requirements satisfied"
}

# Build Rust library
build_rust() {
    log_info "Building Rust library..."

    cd "$RUST_DIR"

    # Build for both architectures
    log_info "Building for x86_64-apple-darwin..."
    cargo build --release --target x86_64-apple-darwin --lib

    log_info "Building for aarch64-apple-darwin..."
    cargo build --release --target aarch64-apple-darwin --lib

    # Create universal binary
    log_info "Creating universal binary..."
    mkdir -p "$BUILD_DIR/lib"

    lipo -create \
        "$RUST_DIR/target/x86_64-apple-darwin/release/librd_agent.dylib" \
        "$RUST_DIR/target/aarch64-apple-darwin/release/librd_agent.dylib" \
        -output "$BUILD_DIR/lib/librd_agent.dylib"

    # Also create static library for linking
    lipo -create \
        "$RUST_DIR/target/x86_64-apple-darwin/release/librd_agent.a" \
        "$RUST_DIR/target/aarch64-apple-darwin/release/librd_agent.a" \
        -output "$BUILD_DIR/lib/librd_agent.a"

    # Copy header
    cp "$RUST_DIR/include/rd_agent.h" "$BUILD_DIR/lib/"

    log_info "Rust library built successfully"
}

# Build Swift application
build_swift() {
    log_info "Building Swift application..."

    cd "$SCRIPT_DIR"

    # Set library search path
    export LIBRARY_SEARCH_PATHS="$BUILD_DIR/lib"
    export SWIFT_INCLUDE_PATHS="$RUST_DIR/include"

    # Build with Swift Package Manager
    swift build \
        -c release \
        -Xlinker -L"$BUILD_DIR/lib" \
        -Xlinker -lrd_agent \
        -Xcc -I"$RUST_DIR/include"

    log_info "Swift application built successfully"
}

# Create application bundle
create_app_bundle() {
    log_info "Creating application bundle..."

    APP_NAME="Remote Desktop Agent"
    APP_BUNDLE="$RELEASE_DIR/$APP_NAME.app"
    CONTENTS_DIR="$APP_BUNDLE/Contents"
    MACOS_DIR="$CONTENTS_DIR/MacOS"
    RESOURCES_DIR="$CONTENTS_DIR/Resources"
    FRAMEWORKS_DIR="$CONTENTS_DIR/Frameworks"

    # Clean previous bundle
    rm -rf "$APP_BUNDLE"

    # Create directory structure
    mkdir -p "$MACOS_DIR"
    mkdir -p "$RESOURCES_DIR"
    mkdir -p "$FRAMEWORKS_DIR"

    # Copy executable
    cp "$SCRIPT_DIR/.build/release/RemoteDesktopAgent" "$MACOS_DIR/"

    # Copy dylib
    cp "$BUILD_DIR/lib/librd_agent.dylib" "$FRAMEWORKS_DIR/"

    # Fix dylib path in executable
    install_name_tool -change \
        "librd_agent.dylib" \
        "@executable_path/../Frameworks/librd_agent.dylib" \
        "$MACOS_DIR/RemoteDesktopAgent"

    # Create Info.plist
    cat > "$CONTENTS_DIR/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>RemoteDesktopAgent</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>io.alga.remote-desktop-agent</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Remote Desktop Agent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2024 Alga PSA. All rights reserved.</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSSupportsAutomaticTermination</key>
    <false/>
    <key>NSSupportsSuddenTermination</key>
    <false/>
</dict>
</plist>
EOF

    # Create entitlements
    cat > "$RELEASE_DIR/entitlements.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
</dict>
</plist>
EOF

    log_info "Application bundle created at: $APP_BUNDLE"
}

# Sign the application (if signing identity is available)
sign_app() {
    if [ -n "$SIGNING_IDENTITY" ]; then
        log_info "Signing application..."

        APP_BUNDLE="$RELEASE_DIR/Remote Desktop Agent.app"

        # Sign the dylib first
        codesign --force --sign "$SIGNING_IDENTITY" \
            --options runtime \
            "$APP_BUNDLE/Contents/Frameworks/librd_agent.dylib"

        # Sign the app bundle
        codesign --force --sign "$SIGNING_IDENTITY" \
            --options runtime \
            --entitlements "$RELEASE_DIR/entitlements.plist" \
            "$APP_BUNDLE"

        log_info "Application signed successfully"
    else
        log_warn "SIGNING_IDENTITY not set. Skipping code signing."
        log_warn "Set SIGNING_IDENTITY to your Developer ID to enable signing."
    fi
}

# Create DMG installer
create_dmg() {
    log_info "Creating DMG installer..."

    DMG_NAME="RemoteDesktopAgent-1.0.0"
    DMG_PATH="$RELEASE_DIR/$DMG_NAME.dmg"

    # Remove existing DMG
    rm -f "$DMG_PATH"

    # Create DMG
    hdiutil create -volname "Remote Desktop Agent" \
        -srcfolder "$RELEASE_DIR/Remote Desktop Agent.app" \
        -ov -format UDZO \
        "$DMG_PATH"

    log_info "DMG created at: $DMG_PATH"
}

# Main build process
main() {
    log_info "Starting Remote Desktop Agent build..."

    # Create directories
    mkdir -p "$BUILD_DIR"
    mkdir -p "$RELEASE_DIR"

    check_requirements
    build_rust
    build_swift
    create_app_bundle
    sign_app
    create_dmg

    log_info "Build complete!"
    log_info "Application: $RELEASE_DIR/Remote Desktop Agent.app"
    log_info "Installer: $RELEASE_DIR/RemoteDesktopAgent-1.0.0.dmg"
}

# Parse arguments
case "${1:-}" in
    rust)
        check_requirements
        build_rust
        ;;
    swift)
        build_swift
        ;;
    bundle)
        create_app_bundle
        ;;
    sign)
        sign_app
        ;;
    dmg)
        create_dmg
        ;;
    clean)
        log_info "Cleaning build artifacts..."
        rm -rf "$BUILD_DIR"
        rm -rf "$RELEASE_DIR"
        rm -rf "$SCRIPT_DIR/.build"
        cd "$RUST_DIR" && cargo clean
        log_info "Clean complete"
        ;;
    *)
        main
        ;;
esac
