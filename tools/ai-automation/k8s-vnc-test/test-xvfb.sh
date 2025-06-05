#!/bin/bash

# Simple Xvfb test script
echo "=== Xvfb Test Script ==="
echo "Running as: $(id)"
echo "Display: $DISPLAY"

# Function to test Xvfb
test_xvfb() {
    local args="$1"
    local description="$2"
    
    echo ""
    echo "Testing: $description"
    echo "Command: Xvfb :99 $args"
    
    # Kill any existing Xvfb
    pkill -f "Xvfb :99" 2>/dev/null || true
    sleep 1
    
    # Start Xvfb
    Xvfb :99 $args > /tmp/xvfb_test.log 2>&1 &
    local pid=$!
    sleep 3
    
    # Check if running
    if kill -0 $pid 2>/dev/null; then
        echo "✓ Xvfb started (PID: $pid)"
        
        # Test display
        if DISPLAY=:99 xdpyinfo > /tmp/xdpyinfo_test.log 2>&1; then
            echo "✓ Display test passed"
            DISPLAY=:99 xdpyinfo | grep -E "dimensions:|depths:"
        else
            echo "✗ Display test failed"
            cat /tmp/xdpyinfo_test.log
        fi
        
        # Check memory usage
        ps aux | grep $pid | grep -v grep
        
        # Kill for next test
        kill $pid 2>/dev/null || true
    else
        echo "✗ Xvfb failed to start"
        cat /tmp/xvfb_test.log
    fi
}

# Run tests
test_xvfb "-screen 0 640x480x8 -ac" "Minimal configuration"
test_xvfb "-screen 0 1024x768x16 -ac -nolisten tcp" "Standard configuration"
test_xvfb "-screen 0 1280x1024x16 -ac -nolisten tcp +extension RANDR" "Extended configuration"

echo ""
echo "Tests completed."