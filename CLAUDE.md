# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HistoryGen AI generates AI-powered historical video content from YouTube URLs. It processes transcripts, rewrites them into scripts, generates voice-cloned audio (6 segments with individual regeneration), creates captions, and produces AI images with timing-based filenames.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend API: Express + TypeScript on Railway (long-running operations, usage-based pricing)
- Quick Functions: Supabase Edge Functions (Deno)
- Storage: Supabase Storage
- TTS: RunPod serverless with ChatterboxTurboTTS voice cloning
- Image Generation: RunPod serverless with Z-Image-Turbo
- Deployment: Netlify (frontend), Railway (API), Supabase (storage + quick functions)

**Live URLs:**
- Frontend: https://historygenai.netlify.app
- Railway API: https://history-gen-ai-production-f1d4.up.railway.app
- Supabase: https://udqfdeoullsxttqguupz.supabase.co

## Development Commands

### Frontend
```bash
npm i                    # Install dependencies
npm run dev              # Start dev server (http://localhost:8080)
npm run build            # Production build
npm run lint             # Run ESLint
npm run preview          # Preview production build
npx playwright test      # Run E2E tests (CI runs on push/PR)
```

**RunPod Monitoring:**
```bash
npm run monitor:runpod              # One-time log fetch
npm run monitor:runpod:watch        # Continuous monitoring
npm run monitor:runpod:errors       # Show errors only
```

### Railway API (`render-api/`)
```bash
cd render-api
npm install              # Install dependencies
npm run dev              # Start dev server with hot reload
npm run build            # Compile TypeScript
npm start                # Start production server
npm run typecheck        # Type check without building
```

### Supabase Functions
```bash
export SUPABASE_ACCESS_TOKEN='your-token'
npx supabase functions deploy <function-name> --project-ref udqfdeoullsxttqguupz
```

## Architecture

### Hybrid Backend Design

Long-running operations run on **Railway** (usage-based pricing, no timeout limits, up to 8GB RAM). Quick operations remain on **Supabase Edge Functions** (2-minute limit).

**Frontend API Client** (`src/lib/api.ts`):
- Uses dual API pattern: Railway API for streaming/long operations, Supabase for quick operations
- All streaming endpoints use Server-Sent Events (SSE) format
- Event types: `progress`, `token` (real-time script streaming), `complete`, `error`
- Dynamic timeouts based on content size (e.g., 150 words/min for scripts)
- 10-minute grace period between SSE events for voice cloning
- No automatic retries (errors returned to user immediately)
- Graceful degradation: returns partial results if stream interrupted (500+ word threshold)

**Railway API Routes** (`render-api/src/routes/`):
| Route | Purpose |
|-------|---------|
| `/rewrite-script` | Streaming script generation with Claude API |
| `/generate-audio` | Voice cloning TTS, splits into 6 segments, returns combined + individual URLs |
| `/generate-audio/segment` | Regenerate a single audio segment |
| `/generate-images` | RunPod Z-Image with rolling concurrency (4 workers max) |
| `/generate-captions` | Whisper transcription with WAV chunking |
| `/get-youtube-transcript` | YouTube transcript via Supadata API |

**Supabase Edge Functions** (`supabase/functions/`):
| Function | Purpose |
|----------|---------|
| `generate-image-prompts` | Claude AI scene descriptions from script + SRT |
| `generate-video` | EDL/CSV timeline files |
| `download-images-zip` | Package images into ZIP |
| `get-elevenlabs-voices` | List available voices |

### Frontend Pipeline (`src/pages/Index.tsx`)

Multi-step generation with user review at each stage:
1. **Transcript Fetch** → Review Script
2. **Script Generation** (streaming) → Review Audio
3. **Audio Generation** (6 segments with voice cloning) → Review Captions
4. **Captions Generation** → Review Images
5. **Image Generation** (streaming, parallel) → Final Results

**UI Features:**
- `ImagesPreviewModal`: Click thumbnails to open full-size lightbox
  - Close with ESC key or click outside the image
  - Lightbox rendered via `createPortal` outside Dialog
  - **Critical pattern**: Uses capture-phase `window.addEventListener` to bypass Radix Dialog's event interception
    - `window.addEventListener('keydown', handler, { capture: true })` for ESC key
    - `window.addEventListener('click', handler, { capture: true })` for background clicks
    - Capture phase runs BEFORE Radix Dialog's bubble-phase handlers, preventing Dialog from blocking events
  - `onPointerDownOutside`/`onInteractOutside` on DialogContent prevent Dialog closing when lightbox is open
- `AudioSegmentsPreviewModal`: "Play All" for combined audio + individual segment players with regeneration
- Default voice sample: `clone_voice.mp3` in `public/voices/` (auto-loaded for new projects)

### Audio Generation Architecture

**Critical: Uses rolling concurrency window with streaming concatenation for maximum speed.**

- Script split into **10 equal segments** by word count (utilizes all 10 RunPod workers)
- **All 10 segments processed in parallel** (utilizing 8GB Railway instance)
- Each segment's chunks processed **sequentially** within the worker (avoids memory issues)
- Voice sample (~117KB = 156KB base64) sent with each TTS job
- Individual segment WAVs uploaded, then concatenated into combined file
- Response includes both `audioUrl` (combined) and `segments[]` (for regeneration)
- Frontend `AudioSegmentsPreviewModal` shows "Play All" (combined) + individual segment players with regeneration

**Performance:**
- 20,000 word script = **10 segments × ~24 chunks each** (vs 6 segments × 40 chunks)
- **Full parallel (10): 2-3 minutes** (all segments process simultaneously with all RunPod workers)
- Sequential (1): ~20 minutes
- Railway usage-based billing: only charged for actual processing time (~3 min/day)

**Memory footprint (10 concurrent segments on 8GB Railway instance):**
- 10 active segments × 36MB (chunk arrays, fewer chunks per segment) = 360MB
- 2-3 completed WAVs awaiting upload = ~110MB
- Segments uploaded immediately after completion
- At end: **Streaming concatenation** (1 segment at a time):
  - Pre-allocate combined WAV buffer (334MB)
  - Download segment 1, extract PCM, copy to combined, clear (33MB temp)
  - Download segment 2, extract PCM, copy to combined, clear (33MB temp)
  - ... repeat for all 10 segments
  - Only 1 segment buffer in memory at a time!
- Node.js overhead = ~300MB
- **Peak during processing: ~770MB** (10 active)
- **Peak during concatenation: ~367MB** (334MB combined + 33MB current segment)
- **Total peak: ~770MB** ✓ Plenty of headroom on 8GB instance

**Key constants** in `render-api/src/routes/generate-audio.ts`:
- `MAX_TTS_CHUNK_LENGTH = 500` chars per TTS chunk
- `DEFAULT_SEGMENT_COUNT = 10` segments (use all RunPod workers)
- `MAX_CONCURRENT_SEGMENTS = 10` (full parallel processing on Railway 8GB)
- `TTS_JOB_POLL_INTERVAL_INITIAL = 250` ms (fast initial polling)
- `TTS_JOB_POLL_INTERVAL_MAX = 1000` ms (adaptive polling cap)
- `RETRY_MAX_ATTEMPTS = 3` (exponential backoff: 1s → 2s → 4s, max 10s)

**Polling & Retry Logic:**
- 5-minute timeout per TTS job (300 attempts, increased from 2 min for slow workers)
- Adaptive polling: starts at 250ms, increases to 1s max after 3 attempts
- Uses RunPod's `delayTime` hint when available (capped at 1.5s)
- Exponential backoff retry for failed chunks (3 attempts max)
- Continues processing if individual chunks fail (skips instead of failing entire job)

**Text Normalization:**
- `normalizeText()` converts smart quotes/dashes to ASCII BEFORE removing non-ASCII
- Order matters: convert `""` → `"`, `''` → `'`, `–—` → `-`, then remove remaining non-ASCII
- Wrong order will strip quotes entirely instead of converting them

**Individual Segment Regeneration:**
- POST `/generate-audio/segment` regenerates a single segment
- Frontend calls `onRegenerate(segmentIndex)` to regenerate specific segment
- Combined audio must be re-concatenated after any regeneration

### RunPod Endpoints

**ChatterboxTurboTTS** (Endpoint: `eitsgz3gndkh3s`):
- Input: `{ text, reference_audio_base64 }`
- Output: 24000Hz mono 16-bit WAV (not 44100Hz!)
- 500 char limit per chunk, 5+ second voice samples required
- GitHub repo: `jonmac909/chatterbox`

**Z-Image-Turbo**:
- Input: `{ prompt, quality: "basic"|"high", aspectRatio: "16:9"|"1:1"|"9:16" }`
- Dimensions must be divisible by 16
- Uses `guidance_scale=0.0` (no negative prompts)

**Dynamic Worker Allocation** (10 workers total across both endpoints):
- RunPod enforces a **global 10-worker limit** across all endpoints
- Audio and images run **sequentially** (never overlap in the pipeline)
- API automatically reallocates workers before each stage:
  - **Before audio:** ChatterboxTTS = 10 workers, Z-Image = 0 workers
  - **Before images:** ChatterboxTTS = 0 workers, Z-Image = 10 workers
- Uses RunPod REST API: `POST /v1/endpoints/{id}/update` with `workersMax`
- Graceful fallback: if allocation fails, continues with current configuration
- **Result:** Each stage gets all 10 workers for maximum speed

**Implementation** (`render-api/src/utils/runpod.ts`):
- `allocateWorkersForAudio()` - called before audio generation
- `allocateWorkersForImages()` - called before image generation
- Both update both endpoints in parallel for faster allocation

### Image Generation Architecture

**Uses rolling concurrency window for maximum speed - utilizes all 10 RunPod workers.**

- **10 concurrent jobs maximum** (uses all available RunPod workers)
- Jobs submitted as workers become available (not all at once)
- Keeps workers 100% busy without queue buildup
- Progress updates after each job completion (predictable UX)

**Performance:**
- 30 images with 10 workers: **~3 batches** (10+10+10)
- Each image takes ~30-60 seconds
- **Total time: ~2-3 minutes** (vs 4-8 min with 4 workers)
- Poll interval: 2 seconds (faster than audio for quick image jobs)
- **60% faster than before!**

**Benefits over submit-all-at-once:**
- Jobs start processing immediately (no queue wait)
- Early failure detection (stop submitting if first batch fails)
- Better progress reporting (batch completion is predictable)
- Less RunPod queue pressure (max 10 jobs in flight vs 30)

## Configuration

### Frontend Environment (`.env`)
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
VITE_RENDER_API_URL=<railway-production-url>
```

### Railway API Environment Variables
Set these in Railway dashboard → Variables:
```
ANTHROPIC_API_KEY=<claude-api-key>
SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RUNPOD_API_KEY=<runpod-key>
RUNPOD_ZIMAGE_ENDPOINT_ID=<z-image-endpoint>
RUNPOD_ENDPOINT_ID=eitsgz3gndkh3s
OPENAI_API_KEY=<openai-key-for-whisper>
SUPADATA_API_KEY=<supadata-key-for-youtube>
PORT=10000
```

**Note:** Railway auto-injects `PORT` variable, but you can set it manually to 10000 for consistency.

### Storage Buckets
- `voice-samples`: User uploaded voice samples (PUBLIC)
- `generated-assets`: All generated content

## Deployment

### Railway API Deployment

**Initial Setup:**
1. Go to [Railway](https://railway.com) and sign up/login
2. Create new project → Deploy from GitHub repo
3. Select repository: `jonmac909/history-gen-ai`
4. Set root directory: `render-api`
5. Railway auto-detects Node.js and uses `railway.json` config

**Environment Variables:**
In Railway dashboard → Variables, add all variables from the "Railway API Environment Variables" section above.

**Build Settings (auto-detected from `package.json`):**
- Build Command: `npm run build` (runs `npm install --include=dev && tsc`)
- Start Command: `npm start` (runs `node dist/index.js`)
- Node Version: >=18 (detected from `engines` field)

**Cost Optimization:**
- Hobby Plan: $5/month (includes $5 credits)
- Usage: ~$0.42/month for once-daily generation (10 min/day)
- **Effective cost: ~$5/month** (vs $44/month on Render)
- Up to 8GB RAM / 8 vCPU available (no memory limits!)

**Auto-deploys:** Push to `main` branch triggers automatic Railway deployment

### Frontend Deployment

**Netlify:** Auto-deploys to Netlify on push to `main`
- Update `VITE_RENDER_API_URL` to Railway production URL after first deploy

### RunPod Workers

**ChatterboxTurboTTS:** GitHub integration auto-rebuilds `jonmac909/chatterbox` (5-10 min)

## Common Issues

### Audio generation "Failed to generate audio"
- Check if `audioUrl` is being returned (backend must concatenate segments)
- Verify `RUNPOD_API_KEY` is set on Render
- Frontend expects both `audioUrl` (combined) AND `segments[]` array

### Captions too short / wrong duration
- Captions must use combined `audioUrl`, not `segments[0].audioUrl`
- Check `pendingAudioUrl` is set from `audioRes.audioUrl`, not first segment
- WAV parsing must find actual 'data' chunk (not assume 44-byte header)
- **Sample rate mismatch**: Chatterbox outputs 24000Hz, not 44100Hz
  - `createWavFromPcm()` must use actual audio format from `extractPcmFromWav()`
  - Hardcoded 44100Hz causes Whisper to transcribe at wrong speed (1.84x faster)
- Progress should start at 5%, not 100% (was bug when only 1 chunk)
- See `extractPcmFromWav()` and `createWavFromPcm()` in `generate-captions.ts`

### Audio preview too short
- `AudioSegmentsPreviewModal` needs `combinedAudioUrl` and `totalDuration` props
- Modal should show "Play All" player for combined audio

### Audio generation slow or workers at capacity
- Segments use full parallel processing (10 concurrent utilizing all RunPod workers on 8GB Railway instance)
- If all RunPod workers busy → increase max workers in RunPod dashboard (currently limited to 10 total across all endpoints)
- Memory usage: 10 segments × 36MB + overhead ≈ 770MB peak (plenty of headroom on 8GB)
- Streaming concatenation keeps concatenation peak at ~367MB
- Railway charges only for actual usage time (~3 min/day = ~$0.30/month)

### Audio timeouts on long scripts
- 5-minute timeout per TTS job should handle most cases
- For very long scripts (1000+ words), processing time increases linearly
- Check RunPod worker logs: `npm run monitor:runpod:errors`
- If retry attempts exhausted, individual chunks are skipped (not fatal)

### Image generation 401 Unauthorized
- Add function to `supabase/config.toml` with `verify_jwt = false`
- Redeploy with `--no-verify-jwt` flag

### Image generation 500 Internal Server Error
- Check Claude model ID is valid: `claude-sonnet-4-20250514`
- NOT `claude-sonnet-4-5-20250514` (wrong format)

### RunPod workers crashing
- Exit code 2: Python import errors
- Exit code 1: PyTorch/torchvision version mismatch
- Check worker logs, push fix to GitHub, wait 5-10 min for rebuild

### Frontend not updating after deploy
- Clear cache: `Cmd+Shift+R` or Incognito
- Check Netlify build status

## File Naming Conventions

Generated images: `{projectId}/images/image_001_00-00-00_to_00-00-45.png`
Audio segments: `{projectId}/voiceover-segment-{1-6}.wav`
Combined audio: `{projectId}/voiceover.wav`

## Default Settings

New projects initialize with:
- Voice sample: `https://historygenai.netlify.app/voices/clone_voice.mp3` (set in `src/pages/Index.tsx`)
- Script template: `template-a`
- AI model: `claude-sonnet-4-5`
- Word count: 1000, Image count: 10, Speed: 1x

## Security

**SSRF Protection** (`render-api/src/routes/generate-audio.ts`):
- Voice sample URLs validated against allowlist
- Allowed domains: `supabase.co`, `supabase.com`, `historygenai.netlify.app`
- Blocks localhost, private IPs, non-HTTPS
