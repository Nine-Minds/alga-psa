# Extension UI Loading Fix for Docker Backend

## Problem Statement

The current extension UI loading system has two different implementations:

1. **Knative Backend (Production)**: Uses custom domains (`*.apps.algapsa.com`) with Temporal provisioning
2. **Docker Backend (Local Dev)**: Intended to use path-based URLs (`/runner/ext-ui/...`) but **incomplete**

### Current Issues

1. The EE extension page component (`packages/product-extensions/ee/entry.tsx`) only supports Knative-style custom domains
2. It requires a `runner_domain` field in the database, which doesn't make sense for Docker local development
3. The `ExtensionIframe` component has hardcoded domain validation that only allows `*.apps.algapsa.com`
4. There's no implementation for content-hash based URLs in the Docker backend path

### What Works

- ✅ Docker runner container runs successfully on port 8085
- ✅ Extension registry, version, and install records in database
- ✅ Extension shows in sidebar menu ("Hello World")
- ✅ Backend abstraction exists (`RunnerBackend` interface)
- ✅ Proxy route exists (`/runner/[...path]`)
- ✅ `buildExtUiSrc()` function supports both modes

### What Doesn't Work

- ❌ Extension page tries to load `https://hello-world.apps.algapsa.com/` instead of `/ext-ui/...`
- ❌ No implementation to serve UI assets for Docker backend
- ❌ Extension iframe refuses to load non-allowed domains
- ❌ Content hash in database is fake (`sha256:1234...`)
- ❌ No actual bundle uploaded to storage

## Root Cause Analysis

The implementation is **incomplete**. The plan document shows:
- Phase 1 (Abstraction) ✅ DONE
- Phase 2 (Proxy Routing) ✅ DONE
- Phase 3 (Tooling) ✅ MOSTLY DONE
- **Missing**: Alternative extension page component for Docker backend that uses content-hash URLs

## Solution Design

### Architecture Decision

For Docker backend (`RUNNER_BACKEND=docker`), we need:

1. **Content-hash based URLs** instead of custom domains
2. **Same-origin serving** via Next.js proxy at `/ext-ui/...`
3. **No `runner_domain` requirement** in database

### Implementation Approach

#### Option A: Conditional Rendering in Extension Page (RECOMMENDED)

Modify `packages/product-extensions/ee/entry.tsx` to:
1. Check `RUNNER_BACKEND` environment variable
2. If `docker`: Use content-hash based iframe URL with `buildExtUiSrc()`
3. If `knative`: Use existing custom domain approach

**Pros:**
- Single component, clear conditional logic
- Leverages existing `buildExtUiSrc()` function
- No duplicate code

**Cons:**
- Mixes two approaches in one component

#### Option B: Separate Page Components

Create `packages/product-extensions/docker/entry.tsx` for Docker mode

**Pros:**
- Clean separation of concerns
- Each mode has its own optimized implementation

**Cons:**
- Need routing logic to select correct component
- More code duplication

### Decision: Go with Option A

It's simpler and the logic is straightforward.

## Implementation Plan

### Step 1: Fix Extension Bundle Content Hash

**Problem**: Bundle has fake hash `sha256:1234...`

**Solution**: Generate real SHA256 hash from extension directory

```bash
# Calculate real content hash
cd ee/extensions/samples/hello-world
tar -czf - . | sha256sum
```

**Update database** with real hash

### Step 2: Upload Bundle to Storage

**Current**: `storage_url` points to local filesystem (`file://...`)

**For Docker backend**:
- Either keep filesystem path (Runner can access it)
- Or upload to MinIO (running on port 4569)

**Decision**: Keep filesystem for now, ensure Runner can access it

### Step 3: Create Docker-Compatible Extension Page Component

**File**: `packages/product-extensions/ee/entry.tsx`

**Changes needed**:

```typescript
import { buildExtUiSrc } from 'server/src/lib/extensions/assets/url.shared';

export default async function Page({ params }: { params: { id: string } }) {
  const id = params.id;
  const runnerBackend = process.env.RUNNER_BACKEND || 'knative';

  // Fetch install info
  const info = await getInstallInfo(id);

  if (runnerBackend === 'docker') {
    // Docker mode: Use content-hash based URLs
    if (!info?.content_hash) {
      return <div>Extension bundle not available</div>;
    }

    const iframeSrc = buildExtUiSrc(id, info.content_hash, '/');
    return <DockerExtensionIframe src={iframeSrc} />;
  } else {
    // Knative mode: Use custom domains
    if (!info?.runner_domain) {
      return <div>Extension runtime domain not available</div>;
    }

    return <ExtensionIframe domain={info.runner_domain} />;
  }
}
```

### Step 4: Create Docker Extension Iframe Component

**File**: `packages/product-extensions/ee/DockerExtensionIframe.tsx`

**Purpose**: Load iframe from same-origin path without domain restrictions

```typescript
'use client';

export default function DockerExtensionIframe({ src }: { src: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Listen for ready message from extension
    const handleMessage = (ev: MessageEvent) => {
      // Allow same origin
      if (ev.origin !== window.location.origin) return;

      const data = ev.data;
      if (data?.alga === true && data?.type === 'ready') {
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    bootstrapIframe({ iframe, allowedOrigin: window.location.origin });

    return () => window.removeEventListener('message', handleMessage);
  }, [src]);

  return (
    <div className="h-full w-full">
      {isLoading && <LoadingIndicator text="Starting extension" />}
      <iframe
        ref={iframeRef}
        src={src}
        className="h-full w-full"
        sandbox="allow-scripts allow-forms allow-same-origin"
      />
    </div>
  );
}
```

### Step 5: Ensure `/ext-ui/...` Route Serves Assets

**File**: `server/src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts`

**Current behavior**:
- If `EXT_UI_HOST_MODE=rust`: Returns 404 or redirects
- If `EXT_UI_HOST_MODE=nextjs`: Serves from storage

**Required**: For Docker backend, set `EXT_UI_HOST_MODE=nextjs` to serve locally

**Verify**: Check that it can load from filesystem storage_url

### Step 6: Update getInstallInfo to Return Content Hash

**File**: `ee/server/src/lib/actions/extensionDomainActions.ts`

**Current**: Only returns `runner_domain`

**Update**: Also return `content_hash` from bundle

```typescript
export async function getInstallInfo(registryId: string) {
  const result = await knex('tenant_extension_install as ti')
    .join('extension_version as ev', 'ti.version_id', 'ev.id')
    .join('extension_bundle as eb', 'eb.version_id', 'ev.id')
    .where({ 'ti.registry_id': registryId, 'ti.tenant_id': tenant })
    .select({
      runner_domain: 'ti.runner_domain',
      content_hash: 'eb.content_hash',
      install_id: 'ti.id'
    })
    .first();

  return result;
}
```

## Testing Plan

### Test 1: Calculate Real Content Hash

```bash
cd ee/extensions/samples/hello-world
find . -type f -exec sha256sum {} \; | sort | sha256sum
# Or use proper tar-based hash
```

### Test 2: Update Database

```sql
UPDATE extension_bundle
SET content_hash = 'sha256:<real_hash>'
WHERE version_id = 'bbbbbbbb-0000-0000-0000-000000000001';
```

### Test 3: Verify Environment

```bash
# In server/.env
RUNNER_BACKEND=docker
RUNNER_PUBLIC_BASE=/ext-ui  # or empty for relative paths
EXT_UI_HOST_MODE=nextjs
```

### Test 4: Test Extension Loading

1. Navigate to extension page
2. Verify iframe src is `/ext-ui/aaaaaaaa.../sha256:.../index.html?path=/`
3. Verify UI assets load
4. Verify ready message received
5. Verify loading indicator disappears

## Rollout Strategy

1. ✅ **Phase 1**: Fix content hash and database
2. ✅ **Phase 2**: Update `getInstallInfo` to return content_hash
3. ✅ **Phase 3**: Create `DockerExtensionIframe` component
4. ✅ **Phase 4**: Update extension page with conditional logic
5. ✅ **Phase 5**: Test end-to-end
6. ✅ **Phase 6**: Document in development guide

## Success Criteria

- [ ] Extension "Hello World" appears in sidebar
- [ ] Clicking extension navigates to extension page
- [ ] Iframe loads with correct src (`/ext-ui/...` path)
- [ ] Extension UI renders correctly
- [ ] Ready message is received
- [ ] Loading indicator disappears
- [ ] Extension displays "Hello World" content

## Next Steps

1. Calculate real content hash for hello-world extension
2. Update database with correct hash
3. Implement code changes in order
4. Test incrementally
5. Document findings
