# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Session Status

**Last Updated:** 2025-12-21
**Claude Version:** Sonnet 4.5 (claude-sonnet-4-5-20250929)

### Recent Activity
- **2025-12-22 (Latest):** Speed optimizations for audio generation
  - Doubled chunk size (250→500 chars) - cuts total TTS jobs in half
  - Faster polling (250ms initial, 1000ms max instead of 500ms/3000ms)
  - Added delayTime hint usage for smarter RunPod polling
  - Reduced verbose logging for less overhead
  - **Expected ~2.5-3x faster** for long scripts (still sequential for stability)
- **2025-12-21:** Reverted audio generation to sequential processing
  - Fixed "Instance failed: Ran out of memory (>2GB)" errors on RunPod workers
  - Removed batched parallel processing that was overwhelming workers
  - Trade-off: Slower but stable and reliable
- **2025-12-21:** Completed migration of all core functions from Supabase to Render
  - Migrated: `generate-audio`, `generate-images`, `generate-captions`, `get-youtube-transcript`
  - All long-running operations now on Render (no timeout limits)
  - Updated frontend to use Render API for all migrated functions
  - Hybrid architecture: Render for processing, Supabase for storage
- **2025-12-20:** Migrated script generation API to Render
  - Deployed v2.0-HONEST-PROGRESS with real progress updates
  - Fixed audio generation chunk validation (skips invalid chunks)

### Current Project State
- **Frontend:** Deployed on Netlify (https://historygenai.netlify.app), auto-deploys from main branch
- **Render API:** Deployed at https://history-gen-ai.onrender.com
  - Handles: script generation, audio, images, captions, YouTube transcripts
  - No timeout limits (eliminates 2-minute Supabase Edge Function limit)
- **Supabase:** Storage + quick functions (image prompts, video timeline, zip downloads)
- **TTS System:** RunPod endpoint `eitsgz3gndkh3s` with ChatterboxTurboTTS voice cloning

## Project Overview

HistoryGen AI is a full-stack application that generates AI-powered historical video content from YouTube URLs. It processes YouTube transcripts, rewrites them into narrated scripts, generates voice cloned audio, creates captions, and produces images for video production.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend API: Express + TypeScript on Render (all long-running operations)
- Storage: Supabase Storage (voice samples, audio, images, captions, scripts)
- Quick Functions: Supabase Edge Functions (image prompts, video timeline, zip downloads)
- TTS: RunPod serverless endpoint running Chatterbox TTS with voice cloning
- Deployment: Netlify (frontend), Render (backend API), Supabase (storage + quick functions)

## Development Commands

### Frontend
```bash
npm i                    # Install dependencies
npm run dev             # Start dev server (http://localhost:8080)
npm run build           # Production build
npm run lint            # Run ESLint
npm test                # Run tests in watch mode
npm run test:run        # Run tests once (for CI)
npm run test:coverage   # Run tests with coverage
npm run test:ui         # Run tests with UI
```

### Render API (`render-api/` directory)
```bash
cd render-api
npm install             # Install dependencies
npm run dev             # Start dev server with hot reload
npm run build           # Compile TypeScript
npm start               # Start production server
npm run typecheck       # Type check without building
```

### Supabase Functions
```bash
# Deploy with CLI (requires Docker)
export SUPABASE_ACCESS_TOKEN='your-token'
npx supabase functions deploy <function-name> --project-ref udqfdeoullsxttqguupz

# Or deploy via Supabase Dashboard (recommended if Docker issues):
# https://supabase.com/dashboard/project/udqfdeoullsxttqguupz/functions
```

## Architecture

### Frontend Flow (`src/pages/Index.tsx`)

Multi-step generation pipeline with review/approval at each stage:

1. **Transcript Fetch** → Review Script
2. **Script Generation** (streaming with progress) → Review Audio
3. **Audio Generation** (streaming with voice cloning) → Review Captions
4. **Captions Generation** → Review Images
5. **Image Generation** (streaming) → Final Results

Each step uses streaming APIs for real-time progress updates (percentages shown in `ProcessingModal.tsx`).

### Render API (`render-api/`)

**Purpose:** Handles all long-running operations without timeout limits (Supabase Edge Functions have 2-minute limits).

**Key Routes:**
- `/rewrite-script` - Streaming script generation with honest progress updates
  - Uses Claude API with 16k token limit per call
  - Generates scripts in 8k word chunks (optimized for responsiveness)
  - Sends real progress only when iterations complete (no fake estimates)
  - Supports 20k+ word scripts (multiple iterations)
- `/generate-audio` - Voice cloning with RunPod Chatterbox TTS (800+ lines)
  - **CRITICAL:** Uses sequential processing (NOT parallel) to avoid memory issues
  - Processes chunks one-at-a-time to minimize RunPod worker memory footprint
  - 500-char chunks (doubled from 250 for 2x fewer API calls)
  - Fast polling with RunPod delayTime optimization
  - Streaming SSE progress updates with heartbeat every 15 seconds
  - WAV file concatenation with validation
  - **Requires 2GB Render tier** for long scripts (559+ chunks)
- `/generate-images` - Z-Image generation via RunPod (418 lines)
  - Parallel job creation and polling
  - Streaming progress updates
  - Supports timed prompts with custom filenames
- `/generate-captions` - Whisper transcription with SRT formatting (264 lines)
  - WAV chunking for 25MB limit
  - Supabase storage integration
- `/get-youtube-transcript` - YouTube transcript fetching via Supadata API (110 lines)

**Environment Variables:**
```
ANTHROPIC_API_KEY=<claude-api-key>
SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
RUNPOD_API_KEY=<runpod-key>
RUNPOD_ZIMAGE_ENDPOINT_ID=<z-image-endpoint-id>
OPENAI_API_KEY=<openai-key-for-whisper>
SUPADATA_API_KEY=<supadata-key-for-youtube>
NODE_ENV=production
```

**Important Notes:**
- TypeScript must be in `dependencies` (not `devDependencies`) for Render builds
- Build command on Render: `npm install --include=dev && npm run build`
- All streaming endpoints use SSE (Server-Sent Events)
- Unlimited timeout allows processing very long scripts and audio generation

### Supabase Edge Functions (`supabase/functions/`)

**NOTE:** Core functions migrated to Render. Remaining Supabase functions are quick operations that won't hit 2-minute timeout.

**Still on Supabase:**
- `generate-image-prompts`: Creates AI image prompts from script (quick operation)
- `generate-video`: Creates EDL/CSV timeline files (quick operation)
- `download-images-zip`: Packages images into downloadable zip (quick operation)
- `get-elevenlabs-voices`: Fetches available ElevenLabs voices (quick API call)

**Migrated to Render:**
- ~~`generate-audio`~~ → Now on Render
- ~~`generate-images`~~ → Now on Render
- ~~`generate-captions`~~ → Now on Render
- ~~`get-youtube-transcript`~~ → Now on Render
- ~~`rewrite-script`~~ → Now on Render (was first to migrate)

### Audio Generation Architecture (CRITICAL - READ BEFORE MODIFYING)

The audio generation endpoint (`render-api/src/routes/generate-audio.ts`) uses **sequential processing** by design to avoid memory issues on RunPod workers.

**Why Sequential, Not Parallel:**
- Voice cloning requires sending voice sample (5-10MB base64) with every TTS job
- Parallel batching (e.g., 10 jobs with `Promise.all()`) = 50-100MB memory just for payloads
- RunPod workers have limited memory (2GB max, often less)
- Sequential = only 1 job + 1 voice sample in memory at a time (~10-15MB)

**Three Handler Functions:**
1. `handleStreaming()` - No voice cloning, default voice, streaming progress
2. `handleVoiceCloningStreaming()` - Voice cloning, streaming progress
3. `handleNonStreaming()` - Optional voice cloning, no streaming

**All three use the same pattern:**
```typescript
// CORRECT - Sequential
for (let i = 0; i < chunks.length; i++) {
  const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
  const output = await pollJobStatus(jobId, apiKey);
  audioChunks.push(base64ToBuffer(output.audio_base64));
}

// WRONG - Parallel (causes memory errors)
const promises = chunks.map(chunk =>
  startTTSJob(chunk, apiKey, referenceAudioBase64)
);
await Promise.all(promises); // ❌ Sends 10MB+ to ALL workers at once
```

**Key Constants (Speed Optimized 2025-12-22):**
- `MAX_TTS_CHUNK_LENGTH = 500` (doubled from 250 - cuts chunks in half for faster processing)
- `TTS_JOB_POLL_INTERVAL_INITIAL = 250ms` (faster initial polling)
- `TTS_JOB_POLL_INTERVAL_MAX = 1000ms` (1 second max for faster job detection)
- Uses RunPod `delayTime` hint for smarter polling intervals
- No `BATCH_SIZE` constant (parallel processing causes memory issues even with 2GB RAM)

### RunPod Chatterbox Endpoint

**GitHub Repo:** `jonmac909/chatterbox` (custom fork)

**Key Files:**
- `handler.py`: RunPod serverless handler accepting `{ text, reference_audio_base64 }`
- `Dockerfile`: Builds container with PyTorch 2.4.0 + torchvision 0.19.0 + chatterbox package
- `requirements.txt`: Dependencies with exact torch versions to match base image
- `pyproject.toml`: Package metadata - MUST match requirements.txt versions

**Critical Version Requirements:**
- PyTorch: **2.4.0** (must match base image `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`)
- torchvision: **0.19.0** (compatible with PyTorch 2.4.0 - mismatches cause `operator torchvision::nms does not exist`)
- torchaudio: **2.4.0**
- ALL THREE files must align: `Dockerfile`, `requirements.txt`, `pyproject.toml`
- Must use `pip install -e .` to install chatterbox package from source
- Voice cloning requires `reference_audio_base64` parameter
- Model loads on container start (takes ~30s), then handles requests

## Common Issues

### Frontend not updating after deploy
- Clear browser cache: `Cmd+Shift+R` or use Incognito
- Check Netlify build status for commit hash
- Frontend JS bundle hash changes with each deploy

### Supabase function deployment with Docker errors
- Use Supabase Dashboard to manually update function code
- Dashboard: Project → Edge Functions → Edit function → Deploy

### Render deployment issues
- **Build fails with "tsc: not found"**: Move TypeScript to `dependencies` in package.json
- **Build command**: Use `npm install --include=dev && npm run build` to install devDependencies for build
- **Image push hanging**: No longer an issue on Render

### RunPod workers crashing (exit code 1 or 2)
- Check worker logs in RunPod dashboard (click on crashed worker for full traceback)
- **Exit code 2:** Usually Python import errors or missing dependencies
- **Exit code 1:** Runtime errors like `operator torchvision::nms does not exist`
- Common causes:
  - **PyTorch/torchvision version mismatch** (most common!) - see Critical Version Requirements above
  - Missing `pip install -e .` in Dockerfile (chatterbox not installed)
  - Wrong handler.py path in CMD (should be `handler.py` not `chatterbox/handler.py`)
  - Missing dependencies in requirements.txt
  - Version conflicts between requirements.txt and pyproject.toml
- After fixing, push to GitHub - RunPod auto-rebuilds (5-10 min)
- Verify build succeeded by checking worker status changes from "Initializing" → "Running" (not "Error")

### Audio generation errors
- **"Instance failed: Ran out of memory (>2GB)" on RunPod workers**:
  - **FIXED:** Sequential processing prevents this
  - **DO NOT** revert to parallel/batched processing without careful memory profiling
  - Voice sample (5-10MB base64) sent to only ONE job at a time, not multiple
  - If you see this again, check for accidental `Promise.all()` on TTS job creation
- **"Text chunk X contains invalid characters or is too short/long"**:
  - Fixed in latest version - invalid chunks are now skipped
  - Check script doesn't have only punctuation or emojis in certain sections
- **Stuck at 15%**: RunPod workers at 100% capacity → increase max workers
- **HTTP 401**: RUNPOD_API_KEY not configured in environment variables

### Script generation progress mismatch
- **FIXED in v2.0-HONEST-PROGRESS**: Progress now shows real completion
- Old behavior: Fake estimates during API calls (misleading)
- New behavior: Progress jumps when iterations complete (0% → 43% → 70% → 100%)
- Expected silence during iterations (60-90 seconds with no updates)

## Configuration

### Frontend Environment Variables (`.env`)
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
VITE_RENDER_API_URL=https://history-gen-ai.onrender.com
```

### Supabase Secrets (Function environment variables)
- `RUNPOD_API_KEY`: RunPod API key for TTS endpoint
- `OPENAI_API_KEY`: For image generation
- `ANTHROPIC_API_KEY`: For script generation (Edge Functions only)
- `SUPABASE_URL`: https://udqfdeoullsxttqguupz.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`: For storage access

**Current RunPod Endpoint:** `eitsgz3gndkh3s` (configurable via `RUNPOD_ENDPOINT_ID` env var or fallback in `generate-audio/index.ts` line 9)

## Deployment

### Frontend (Netlify)
- Auto-deploys on push to `main` branch
- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables set in Netlify dashboard

### Render API
- Auto-deploys on push to `main` branch
- Root directory: `render-api`
- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Environment variables set in Render dashboard
- **Memory tier:** 512MB recommended (peak usage ~130-140MB)
  - Can use free tier 512MB safely with sequential audio processing
  - 1GB for extra headroom with concurrent requests
  - 2GB is overkill for current workload
- Free tier has cold starts (~30 seconds when inactive)

### Supabase Edge Functions
- Deploy via CLI: `npx supabase functions deploy <name> --project-ref udqfdeoullsxttqguupz`
- Or via Dashboard: https://supabase.com/dashboard/project/udqfdeoullsxttqguupz/functions
- Storage buckets:
  - `voice-samples`: User uploaded voice samples
  - `generated-assets`: Generated audio, scripts, captions, images

### RunPod
- GitHub integration: Watches `jonmac909/chatterbox` repo
- Auto-rebuilds on push (5-10 min build time)
- Manual rebuild via RunPod dashboard if needed

## Known Issues & Technical Debt

### Version Management
- **Outdated Deno std library:** Some Supabase functions use `std@0.168.0` (from 2022), `generate-audio` updated to `std@0.224.0`
- **No version pinning:** Supabase functions use `@supabase/supabase-js@2` without specific version

### Security
- **SSRF protection implemented** in `generate-audio` but not in other functions
- **Unsafe env var access:** Some places use `Deno.env.get('VAR')!` without null checks
- **No rate limiting:** Edge Functions and Render API have no rate limiting

### Code Quality
- **Inconsistent error handling:** Some functions return error objects, others throw exceptions
- **Limited test coverage:** Frontend has some tests, backend has zero tests
- **No retry logic in Edge Functions:** External API failures have no automatic retry (Render API has retry)

### Performance
- **No caching:** Repeated generations of same YouTube URL re-fetch transcript every time
- **Sequential chunk processing:** Audio chunks processed one-by-one
  - **DO NOT parallelize** without solving RunPod worker memory issues
  - Parallel batching caused "Ran out of memory (>2GB)" errors
  - Sequential is slower but reliable
- **Render cold starts:** Free tier has ~30s cold start when inactive

### Missing Features
- **No project persistence:** All generated content is ephemeral (lost on page refresh)
- **No error boundaries:** React app crashes on any component error
- **No offline support:** Requires constant internet connection
