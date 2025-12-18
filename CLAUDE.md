# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Session Status

**Last Updated:** 2025-12-18
**Claude Version:** Sonnet 4.5 (claude-sonnet-4-5-20250929)
**Authentication:** Claude account (switched from API key)

### Recent Activity
- **2025-12-18:** Fixed RunPod handler bugs and hardened error handling
  - Switched to ChatterboxTurboTTS (was using wrong class name)
  - Added voice sample validation (5+ seconds required)
  - Added GPU OOM handling with graceful errors
  - Added comprehensive input validation and error messages
  - Updated to new RunPod endpoint: `eitsgz3gndkh3s`
- Switched from API key authentication to Claude account authentication for Claude Code
- Confirmed using latest Claude Sonnet 4.5 model
- Project state: Stable, all systems operational

### Current Project State
- **Frontend:** Deployed on Netlify, auto-deploys from main branch
- **Backend:** Supabase Edge Functions operational
- **TTS System:** RunPod endpoint `eitsgz3gndkh3s` with ChatterboxTurboTTS voice cloning
- **Voice Cloning:** Functional with hardened error handling (requires 5+ second voice samples)

### Next Steps
- Monitor voice cloning quality and performance
- Consider addressing technical debt items (see Known Issues section below)
- Optional: Update Deno std library versions in Supabase functions

## Project Overview

HistoryGen AI is a full-stack application that generates AI-powered historical video content from YouTube URLs. It processes YouTube transcripts, rewrites them into narrated scripts, generates voice cloned audio, creates captions, and produces images for video production.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend: Supabase Edge Functions (Deno)
- Storage: Supabase Storage (for audio, scripts, captions, images)
- TTS: RunPod serverless endpoint running Chatterbox TTS with voice cloning
- Deployment: Netlify (frontend), Supabase (backend)

## Development Commands

```bash
# Frontend development
npm i                    # Install dependencies
npm run dev             # Start dev server (http://localhost:8080)
npm run build           # Production build
npm run lint            # Run ESLint

# Supabase functions (requires Docker for CLI deployment)
export SUPABASE_ACCESS_TOKEN='your-token'
npx supabase functions deploy <function-name>

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

### Supabase Edge Functions (`supabase/functions/`)

**`generate-audio/index.ts`** (Main TTS function):
- Receives: `{ script, voiceSampleUrl, projectId, stream: true }`
- Downloads voice sample from Supabase storage
- Converts to base64 for RunPod
- Splits text into 180-char chunks (Chatterbox limitation)
- Sends chunks sequentially to RunPod endpoint `ei3k5udz4c68b8`
- Streams progress: 5% → 10% → 15-75% (per chunk) → 80% → 90% → 100%
- Concatenates WAV audio, uploads to storage
- Returns: `{ audioUrl, duration, size }`

**Other functions:**
- `get-youtube-transcript`: Fetches YouTube captions
- `rewrite-script`: Streams script generation with word count progress
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

### Audio generation stuck at 15%
- RunPod workers at 100% capacity → increase max workers
- RunPod endpoint ID mismatch → verify in `generate-audio/index.ts` line 9
- Workers initializing → wait for "Running" status

## Configuration

**Environment Variables** (`.env`):
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
```

**Supabase Secrets** (Function environment variables):
- `RUNPOD_API_KEY`: RunPod API key for TTS endpoint
- `OPENAI_API_KEY`: For image generation
- Other API keys as needed

**Current RunPod Endpoint:** `eitsgz3gndkh3s` (configurable via `RUNPOD_ENDPOINT_ID` env var or fallback in `generate-audio/index.ts` line 9)

## Deployment

**Frontend (Netlify):**
- Auto-deploys on push to `main` branch
- Build command: `npm run build`
- Publish directory: `dist`

**Backend (Supabase):**
- Functions: Deploy via CLI or Dashboard
- Storage: Buckets configured in Supabase dashboard
  - `voice-samples`: User uploaded voice samples
  - `generated-assets`: Generated audio, scripts, captions, images

**RunPod:**
- GitHub integration: Watches `jonmac909/chatterbox` repo
- Auto-rebuilds on push (5-10 min build time)
- Manual rebuild via RunPod dashboard if needed

## Known Issues & Technical Debt

### Version Management
- **Outdated Deno std library:** All Supabase functions use `std@0.168.0` (from 2022). Should update to `std@0.224.0+`
- **Weak TypeScript config:** Strict mode disabled (`strictNullChecks: false`, `noImplicitAny: false`)
- **No version pinning:** Supabase functions use `@supabase/supabase-js@2` without specific version

### Security
- **No SSRF protection:** Voice sample URLs not validated for malicious domains (should restrict to Supabase storage)
- **Unsafe env var access:** Many places use `Deno.env.get('VAR')!` without null checks (will crash if missing)
- **No rate limiting:** Edge Functions have no rate limiting implemented

### Code Quality
- **Excessive logging:** 100+ console.log statements in production code
- **Inconsistent error handling:** Some functions return error objects, others throw exceptions
- **No tests:** Zero test coverage across entire codebase
- **No retry logic:** External API failures (OpenAI, RunPod) have no automatic retry

### Performance
- **No caching:** Repeated generations of same YouTube URL re-fetch transcript every time
- **Sequential chunk processing:** Audio chunks processed one-by-one, could parallelize some operations
- **Large timeouts:** 2-minute polling timeout for TTS may be insufficient for long scripts

### Missing Features
- **No project persistence:** All generated content is ephemeral (lost on page refresh)
- **No error boundaries:** React app crashes on any component error
- **No offline support:** Requires constant internet connection
