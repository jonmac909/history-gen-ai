# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Session Status

**Last Updated:** 2025-12-20
**Claude Version:** Sonnet 4.5 (claude-sonnet-4-5-20250929)

### Recent Activity
- **2025-12-20:** Migrated script generation API from Railway to Render
  - Railway had persistent infrastructure issues (image push hanging at 285MB/285.1MB)
  - Deployed v2.0-HONEST-PROGRESS to Render successfully
  - Fixed progress bar to show real progress (no fake estimates)
  - Fixed audio generation chunk validation (skips invalid chunks instead of failing)
- **2025-12-18:** Fixed RunPod handler bugs and hardened error handling
  - Switched to ChatterboxTurboTTS
  - Added voice sample validation (5+ seconds required)
  - Added GPU OOM handling with graceful errors
  - Updated to RunPod endpoint: `eitsgz3gndkh3s`

### Current Project State
- **Frontend:** Deployed on Netlify (https://historygenai.netlify.app), auto-deploys from main branch
- **Script Generation API:** Deployed on Render (https://history-gen-ai.onrender.com)
  - Handles long-running script generation with honest progress updates
  - No timeout limits (Railway replacement)
- **Backend:** Supabase Edge Functions operational
- **TTS System:** RunPod endpoint `eitsgz3gndkh3s` with ChatterboxTurboTTS voice cloning
- **Voice Cloning:** Functional with hardened error handling (requires 5+ second voice samples)

## Project Overview

HistoryGen AI is a full-stack application that generates AI-powered historical video content from YouTube URLs. It processes YouTube transcripts, rewrites them into narrated scripts, generates voice cloned audio, creates captions, and produces images for video production.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Script Generation API: Express + TypeScript on Render (unlimited timeout for 20k+ word scripts)
- Backend: Supabase Edge Functions (Deno)
- Storage: Supabase Storage (for audio, scripts, captions, images)
- TTS: RunPod serverless endpoint running Chatterbox TTS with voice cloning
- Deployment: Netlify (frontend), Render (script API), Supabase (edge functions)

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

### Render API (`railway-api/` directory)
```bash
cd railway-api
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

### Render API (`railway-api/`)

**Purpose:** Handles long-running script generation without timeout limits (Railway/Supabase Edge Functions have 2-minute limits).

**Key Routes:**
- `/rewrite-script` - Streaming script generation with honest progress updates
  - Uses Claude API with 16k token limit per call
  - Generates scripts in 8k word chunks (optimized for responsiveness)
  - Sends real progress only when iterations complete (no fake estimates)
  - Supports 20k+ word scripts (multiple iterations)
- `/generate-audio` - Proxies to Supabase `generate-audio` function
- `/generate-images` - Proxies to Supabase `generate-images` function

**Environment Variables:**
```
ANTHROPIC_API_KEY=<claude-api-key>
SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
SUPABASE_ANON_KEY=<supabase-publishable-key>
RUNPOD_API_KEY=<runpod-key>
NODE_ENV=production
```

**Important Notes:**
- TypeScript must be in `dependencies` (not `devDependencies`) for Render builds
- Build command on Render: `npm install --include=dev && npm run build`
- Progress updates send `type: 'progress'` events only when iterations complete
- Keepalive pings send `type: 'keepalive'` to prevent connection drops

### Supabase Edge Functions (`supabase/functions/`)

**`generate-audio/index.ts`** (Main TTS function):
- Receives: `{ script, voiceSampleUrl, projectId, stream: true }`
- Downloads voice sample from Supabase storage
- Converts to base64 for RunPod
- Splits text into 180-char chunks (Chatterbox limitation)
- **Validates chunks and skips invalid ones** (won't fail entire job)
- Sends chunks sequentially to RunPod endpoint `eitsgz3gndkh3s`
- Streams progress: 5% → 10% → 15-75% (per chunk) → 80% → 90% → 100%
- Concatenates WAV audio, uploads to storage
- Returns: `{ audioUrl, duration, size }`

**Text Validation Rules:**
- Min length: 5 characters
- Max length: 400 characters per chunk
- Must contain alphanumeric characters
- Rejects emojis and non-ASCII unicode
- Normalizes text before validation (strips special chars)

**Other functions:**
- `get-youtube-transcript`: Fetches YouTube captions
- `rewrite-script`: Streams script generation (NOTE: Has 2-min timeout, use Render API for >3k words)
- `generate-images`: Streams image generation (DALL-E 3 via OpenAI)
- `generate-captions`: Creates SRT files from audio

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
- **Image push hanging**: This was a Railway infrastructure bug - shouldn't happen on Render

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
- **"Text chunk X contains invalid characters or is too short/long"**:
  - Fixed in latest version - invalid chunks are now skipped
  - Check script doesn't have only punctuation or emojis in certain sections
- **Stuck at 15%**: RunPod workers at 100% capacity → increase max workers
- **HTTP 401**: RUNPOD_API_KEY not configured in Supabase Edge Functions secrets

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
VITE_RAILWAY_API_URL=https://history-gen-ai.onrender.com
```

Note: `VITE_RAILWAY_API_URL` points to Render (not Railway) - variable name kept for backwards compatibility.

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
- Root directory: `railway-api`
- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Environment variables set in Render dashboard
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
- **Sequential chunk processing:** Audio chunks processed one-by-one, could parallelize
- **Render cold starts:** Free tier has ~30s cold start when inactive

### Missing Features
- **No project persistence:** All generated content is ephemeral (lost on page refresh)
- **No error boundaries:** React app crashes on any component error
- **No offline support:** Requires constant internet connection
