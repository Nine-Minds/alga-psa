# VNC Kubernetes Fixes Summary

## Problem
The VNC setup was working in local Docker but failing in Kubernetes with Xvfb crashing with "Aborted (core dumped)" error.

## Root Causes
1. Missing cleanup of X server lock files
2. Overly aggressive display settings for constrained Kubernetes environment  
3. Missing shared memory volume mount required for Xvfb
4. Inadequate resource requests/limits
5. **DRI/Mesa driver compatibility issues** (discovered later)

## Fixes Applied

### 1. Updated VNC Startup Scripts
- Created `vnc-startup-improved.sh` with:
  - Proper lock file cleanup before starting Xvfb
  - Conservative display settings that work in Kubernetes
  - Better error handling and fallback options
  - Color-coded logging for easier debugging

### 2. Dockerfile Updates
- Added Xvfb environment variables for better compatibility:
  ```dockerfile
  ENV XVFB_WHD=1280x1024x16
  ENV XVFB_COLORDEPTH=16
  ENV XVFB_ARGS="-ac -nolisten tcp -dpi 96 +extension RANDR"
  ```
- Script now uses the improved VNC startup script when available

### 3. Helm Template Updates

#### api-deployment.yaml
- Added shared memory volume (critical for Xvfb):
  ```yaml
  volumeMounts:
    - name: shm
      mountPath: /dev/shm
  volumes:
    - name: shm
      emptyDir:
        medium: Memory
        sizeLimit: 256Mi
  ```
- Added Xvfb environment variables
- Updated health check endpoints and timings
- Increased initial delay for liveness probe to 60s

#### values-dev-env.yaml
- Increased resource requests for AI API:
  - CPU: 250m → 500m
  - Memory: 512Mi → 1Gi

## Verification
Successfully tested in Kubernetes with all VNC services running:
- Xvfb virtual display on :99
- Fluxbox window manager
- x11vnc VNC server on port 5901
- Websockify WebSocket proxy on port 5900
- AI automation application on port 4000

## Why Our Tests Didn't Catch the DRI Driver Issue

The DRI/Mesa driver crash was not caught in initial testing because:

1. **Environment-Dependent Failures**: Graphics driver crashes depend on:
   - Host kernel version and modules
   - Container runtime configuration
   - Specific Mesa/DRI library versions
   - Memory allocation patterns

2. **Intermittent Nature**: The crash only occurs when:
   - Xvfb tries to initialize OpenGL extensions
   - The software rasterizer (swrast_dri.so) encounters specific conditions
   - Different Kubernetes nodes may have different behaviors

3. **Test Coverage Gap**: Our tests verified:
   - ✓ X server startup and display availability
   - ✓ VNC service connectivity
   - ✗ OpenGL/DRI driver compatibility under various conditions

## Additional Fixes for DRI Issues

### Dockerfile Changes
```dockerfile
# Force software rendering to avoid DRI driver issues
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe
ENV LP_NO_RAST=false
ENV LIBGL_DRI3_DISABLE=1
ENV LIBGL_ALWAYS_INDIRECT=1
```

### Script Updates
- Disable GLX extension in Xvfb: `-extension GLX`
- Force software rendering environment variables
- Add fallback configurations without problematic extensions

## Comprehensive Testing

Use the new test script to catch these issues:
```bash
./test-vnc-comprehensive.sh
```

This tests:
- Binary availability
- DRI/OpenGL compatibility
- Memory constraints
- Shared memory availability
- Display connectivity
- Full VNC stack

## Using the Fixed Container
The container is already configured in the Helm values to use:
- Repository: `harbor.nineminds.com/nineminds/alga-ai-api`
- Tag: `latest`

To build a new image with all fixes:
```bash
./cli.nu build-ai-api --push --use-latest
```

Or for a specific tag:
```bash
./cli.nu build-ai-api --tag vnc-fixes-v2 --push
```