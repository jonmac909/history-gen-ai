# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HistoryGen AI generates AI-powered historical video content from YouTube URLs. It processes transcripts, rewrites them into scripts, generates voice-cloned audio (6 segments with individual regeneration), creates captions, and produces AI images with timing-based filenames.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend API: Express + TypeScript on Render (long-running operations)
- Quick Functions: Supabase Edge Functions (Deno)
- Storage: Supabase Storage
- TTS: RunPod serverless with ChatterboxTurboTTS voice cloning
- Image Generation: RunPod serverless with Z-Image-Turbo
- Deployment: Netlify (frontend), Render (API), Supabase (storage + quick functions)

**Live URLs:**
- Frontend: https://historygenai.netlify.app
- Render API: https://history-gen-ai.onrender.com
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

### Render API (`render-api/`)
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

Long-running operations run on **Render** (no timeout limits). Quick operations remain on **Supabase Edge Functions** (2-minute limit).

**Frontend API Client** (`src/lib/api.ts`):
- Uses dual API pattern: Render API for streaming/long operations, Supabase for quick operations
- All streaming endpoints use Server-Sent Events (SSE) format
- Event types: `progress`, `token` (real-time script streaming), `complete`, `error`
- Dynamic timeouts based on content size (e.g., 150 words/min for scripts)
- 10-minute grace period between SSE events for voice cloning
- No automatic retries (errors returned to user immediately)
- Graceful degradation: returns partial results if stream interrupted (500+ word threshold)

**Render API Routes** (`render-api/src/routes/`):
| Route | Purpose |
|-------|---------|
| `/rewrite-script` | Streaming script generation with Claude API |
| `/generate-audio` | Voice cloning TTS, splits into 6 segments, returns combined + individual URLs |
| `/generate-audio/segment` | Regenerate a single audio segment |
| `/generate-images` | Parallel RunPod Z-Image jobs with streaming progress |
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

**Critical: Uses parallel segment processing for speed, sequential chunk processing for stability.**

- Script split into 6 equal segments by word count
- **6 segments processed in PARALLEL** (uses up to 6 RunPod workers simultaneously)
- Each segment's chunks processed **sequentially** within the worker (avoids memory issues)
- Voice sample (~117KB = 156KB base64) sent with each TTS job
- Individual segment WAVs uploaded, then concatenated into combined file
- Response includes both `audioUrl` (combined) and `segments[]` (for regeneration)
- Frontend `AudioSegmentsPreviewModal` shows "Play All" (combined) + individual segment players with regeneration

**Performance:**
- 20,000 word script = 6 segments × ~40 chunks each
- Parallel processing: ~3-5 minutes (limited by longest segment)
- Sequential would be: ~20 minutes (6× slower)
- Memory footprint: ~36MB for 6 concurrent segments (well within 2GB Render limit)

**Key constants** in `render-api/src/routes/generate-audio.ts`:
- `MAX_TTS_CHUNK_LENGTH = 500` chars per TTS chunk
- `DEFAULT_SEGMENT_COUNT = 6` segments (processed in parallel)
- `TTS_JOB_POLL_INTERVAL_INITIAL = 250` ms (fast initial polling)
- `TTS_JOB_POLL_INTERVAL_MAX = 1000` ms (adaptive polling cap)
- `RETRY_MAX_ATTEMPTS = 3` (exponential backoff: 1s → 2s → 4s, max 10s)
- Parallel segments utilize multiple RunPod workers (up to 6 concurrent jobs)

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

## Configuration

### Frontend Environment (`.env`)
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
VITE_RENDER_API_URL=https://history-gen-ai.onrender.com
```

### Render API Environment
```
ANTHROPIC_API_KEY=<claude-api-key>
SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RUNPOD_API_KEY=<runpod-key>
RUNPOD_ZIMAGE_ENDPOINT_ID=<z-image-endpoint>
OPENAI_API_KEY=<openai-key-for-whisper>
SUPADATA_API_KEY=<supadata-key-for-youtube>
```

### Storage Buckets
- `voice-samples`: User uploaded voice samples (PUBLIC)
- `generated-assets`: All generated content

## Deployment

**Frontend:** Auto-deploys to Netlify on push to `main`

**Render API:** Auto-deploys on push to `main`
- Root directory: `render-api`
- Build: `npm install --include=dev && npm run build`
- Start: `npm start`
- **Memory tier: 2GB required** for long scripts (500+ audio chunks)

**RunPod:** GitHub integration auto-rebuilds `jonmac909/chatterbox` (5-10 min)

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
- Segments process in parallel (up to 6 concurrent workers)
- If all workers busy → increase max workers in RunPod dashboard
- Memory is safe: 6 segments × 40 chunks × 150KB ≈ 36MB (well under 2GB limit)

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
