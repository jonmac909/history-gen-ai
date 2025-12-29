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

**Note:** The `render-api/` folder and `VITE_RENDER_API_URL` env var retain "render" in their names for historical reasons (originally deployed on Render.com), but the API now runs on Railway.

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
| `/render-video` | FFmpeg video rendering (no captions), SSE progress |

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
4. **Captions Generation** → Review Image Prompts
5. **Image Prompts Review** (editable scene descriptions) → Generate Images
6. **Image Generation** (streaming, parallel) → Final Results (with video export options)

**UI Features:**
- **All preview modals** include:
  - Back button to return to previous pipeline step
  - Download button to save progress (script.txt, voiceover.wav, captions.srt, image-prompts.json, or all images)
- `ImagesPreviewModal`: Click thumbnails to open full-size lightbox
  - Close with ESC key or click outside the image
  - Lightbox rendered via `createPortal` outside Dialog
  - **Critical pattern**: Uses capture-phase `window.addEventListener` to bypass Radix Dialog's event interception
    - `window.addEventListener('keydown', handler, { capture: true })` for ESC key
    - `window.addEventListener('click', handler, { capture: true })` for background clicks
    - Capture phase runs BEFORE Radix Dialog's bubble-phase handlers, preventing Dialog from blocking events
  - `onPointerDownOutside`/`onInteractOutside` on DialogContent prevent Dialog closing when lightbox is open
  - Edit prompt inline and regenerate individual images
- `AudioSegmentsPreviewModal`: "Play All" for combined audio + individual segment players with regeneration
- `ImagePromptsPreviewModal`:
  - Collapsible Master Style Prompt editor (applies to all images)
  - Individual scene description editing per image
- Default voice sample: `clone_voice.mp3` in `public/voices/` (auto-loaded for new projects)
- `ProjectResults`: Final downloads page with export options:
  - Script, Audio, Captions, Images (ZIP) downloads
  - **Timeline Export (FCPXML)**: Client-side XML for DaVinci Resolve/FCP/Premiere
  - **Render Video (MP4)**: Server-side FFmpeg rendering via `/render-video`

### Audio Generation Architecture

**Critical: Uses parallel processing with 10 segments to match RunPod worker allocation.**

- Script split into **10 equal segments** by word count
- **All 10 segments processed in parallel** (utilizing 10 RunPod workers)
- Each segment's chunks processed **sequentially** within the worker (avoids memory issues)
- Voice sample (~117KB = 156KB base64) sent with each TTS job
- Individual segment WAVs uploaded, then concatenated into combined file
- **Post-processing**:
  - **Proactive repetition removal**: Detects and removes duplicate sentences in source text BEFORE TTS (70% similarity threshold)
  - **Reactive repetition removal**: Whisper transcribes audio, detects repeated phrases in generated audio (70% similarity), FFmpeg removes duplicates
  - Requires both `ffmpeg-static` and `ffprobe-static` packages for post-processing
- Response includes both `audioUrl` (combined) and `segments[]` (for regeneration)
- Frontend `AudioSegmentsPreviewModal` shows "Play All" (combined) + individual segment players with regeneration

**Key constants** in `render-api/src/routes/generate-audio.ts`:
- `MAX_TTS_CHUNK_LENGTH = 250` chars per TTS chunk (reduced to prevent repetition)
- `DEFAULT_SEGMENT_COUNT = 10` segments (match RunPod max workers for audio)
- `MAX_CONCURRENT_SEGMENTS = 10` (parallel processing)
- `TTS_JOB_POLL_INTERVAL_INITIAL = 250` ms (fast initial polling)
- `TTS_JOB_POLL_INTERVAL_MAX = 1000` ms (adaptive polling cap)
- `RETRY_MAX_ATTEMPTS = 3` (exponential backoff: 1s → 2s → 4s, max 10s)
- `PRONUNCIATION_FIXES` dictionary for phonetic replacements of commonly mispronounced words

**Polling & Retry Logic:**
- 5-minute timeout per TTS job (300 attempts, increased from 2 min for slow workers)
- Adaptive polling: starts at 250ms, increases to 1s max after 3 attempts
- Uses RunPod's `delayTime` hint when available (capped at 1.5s)
- Exponential backoff retry for failed chunks (3 attempts max)
- Continues processing if individual chunks fail (skips instead of failing entire job)

**Text Normalization & Cleaning:**
- **Script cleaning** removes markdown headers, scene markers, and metadata BEFORE TTS:
  - Removes entire lines starting with `#` (both `#TheMedievalTavern` and `# Title`)
  - Removes standalone ALL CAPS lines (section headers like `OPENING`, `CONCLUSION`)
  - Removes inline hashtags (e.g., `#TheMedievalTavern` in middle of text)
  - Removes markdown bold/italic markers `*`, `**`, `***` (keeps text content)
  - Removes parenthetical time markers like `(5-10 minutes)`
  - Removes scene markers `[SCENE X]` and other bracketed content
  - Critical: Failing to remove headers causes dead air/silence or unwanted narration
- `normalizeText()` converts smart quotes/dashes to ASCII BEFORE removing non-ASCII
- Order matters: convert `""` → `"`, `''` → `'`, `–—` → `-`, then remove remaining non-ASCII
- Wrong order will strip quotes entirely instead of converting them
- **Number-to-words conversion**: "ACT 5" → "Act Five", years like "1347" → "thirteen forty-seven"
- **Pronunciation fixes**: Dictionary-based phonetic replacements for difficult proper nouns (e.g., "Byzantine" → "Biz-an-tine")

**Individual Segment Regeneration:**
- POST `/generate-audio/segment` regenerates a single segment
- Frontend calls `onRegenerate(segmentIndex)` to regenerate specific segment
- Combined audio must be re-concatenated after any regeneration

### RunPod Endpoints

**ChatterboxTurboTTS** (Endpoint: `eitsgz3gndkh3s`):
- Input: `{ text, reference_audio_base64 }`
  - **Critical:** `reference_audio_base64` MUST be WAV format base64
  - MP3/other formats are auto-converted to 24000Hz mono 16-bit WAV via ffmpeg
- Output: 24000Hz mono 16-bit WAV (not 44100Hz!)
- 500 char limit per chunk, 5+ second voice samples required
- GitHub repo: `jonmac909/chatterbox`

**Z-Image-Turbo**:
- Input: `{ prompt, quality: "basic"|"high", aspectRatio: "16:9"|"1:1"|"9:16" }`
- Dimensions must be divisible by 16
- Uses `guidance_scale=0.0` (no negative prompts)

**RunPod Worker Allocation**:
- **10 workers for audio (ChatterboxTTS)**, **4 workers for images (Z-Image)**
- Set in RunPod dashboard endpoint settings
- **Memory optimization**: Audio processing uses **incremental concatenation** to prevent Railway OOM kills
  - Old approach: accumulated all chunks in array (35 chunks × 1.77MB = ~60MB per segment × 10 = 600MB)
  - New approach: incrementally concatenates chunks (only 1 combined buffer per segment = ~10MB total)
  - All 10 workers utilized concurrently via `MAX_CONCURRENT_SEGMENTS=10`
  - Node.js memory flags: `--max-old-space-size=4096 --optimize-for-size --gc-interval=100`

### Image Generation Architecture

**Uses rolling concurrency window with 4 workers for parallel image generation.**

- **4 concurrent jobs maximum** (matches RunPod Z-Image worker allocation)
- Jobs submitted as workers become available (not all at once)
- Keeps workers 100% busy without queue buildup
- Progress updates after each job completion (predictable UX)

**Key constant** in `render-api/src/routes/generate-images.ts`:
- `MAX_CONCURRENT_JOBS = 4` (match RunPod max workers for image endpoint)

**Benefits of rolling concurrency:**
- Jobs start processing immediately (no queue wait)
- Early failure detection (stop submitting if first batch fails)
- Better progress reporting (batch completion is predictable)
- Less RunPod queue pressure (max 4 jobs in flight)

### Captions Generation Architecture

**Uses parallel Whisper processing for faster transcription.**

- Audio split into ~227s chunks (20MB max for Whisper API)
- **Parallel processing**: Up to 3 chunks transcribed concurrently
- Language hint (`en`) skips language detection (~5-10% faster)
- Results sorted by chunk index and merged with proper time offsets
- Caption segments: 5-7 words max, 3 words min per line

**Key constants** in `render-api/src/routes/generate-captions.ts`:
- `MAX_CHUNK_BYTES = 20 * 1024 * 1024` (20MB per Whisper chunk)
- `MAX_PARALLEL_CHUNKS = 3` (concurrent Whisper API calls)

### Script Rewriting Architecture

**Uses Claude Sonnet 4.5 with prompt caching for faster iterations.**

- Prompt caching enabled on ALL iterations for 5-10% speed improvement + 90% cost reduction
- Streaming tokens via SSE for real-time display
- Model: `claude-sonnet-4-5`
- Max tokens: 16000, Words per iteration: 12000

**Script Output Format (CRITICAL):**
- Scripts must be ONLY plain text prose narration - no markdown formatting
- System prompt explicitly forbids: `#` headers, `**bold**`, section markers, brackets, hashtags
- Script templates (`src/data/defaultTemplates.ts`) include warnings that structural labels (OPENING, ACT 1, etc.) are instructions only
- Defense-in-depth: Audio generation also strips formatting if it slips through
- Templates have prominent warnings: "DO NOT INCLUDE ANY OF THIS MARKDOWN FORMATTING IN YOUR OUTPUT"

### Scene Description (Image Prompts) Architecture

**Uses Claude Sonnet with prompt caching and parallel batching.**

- Prompt caching on system prompt for cost reduction
- Parallel batches of 10 images each for faster generation
- Model: `claude-sonnet-4-20250514`
- Content safety rules for documentary-appropriate imagery

### Video Rendering Architecture

**Server-side FFmpeg rendering with chunked processing and embers overlay.**

**Chunked Rendering Pipeline:**
1. Download audio + images + embers overlay from Supabase/Netlify
2. Split images into chunks (25 images per chunk)
3. Render each chunk with two-pass approach:
   - Pass 1: Images → raw chunk video (scale, letterbox)
   - Pass 2: Apply embers overlay via screen blend
4. Concatenate chunks (fast copy, no re-encode)
5. Add audio (fast mux)
6. Upload final MP4 to Supabase

**Embers Overlay:**
- Source: `public/overlays/embers.mp4` (~10s, served from Netlify)
- Applied per-chunk using concat demuxer (NOT -stream_loop which crashes on long videos)
- Uses `colorkey` to remove black background, then `overlay` (not blend mode)
- Filter: `colorkey=black:similarity=0.3:blend=0.2` → transparent embers over video
- Graceful fallback: if embers pass fails, uses raw chunk without embers

**Key constants** in `render-api/src/routes/render-video.ts`:
- `IMAGES_PER_CHUNK = 25` images per chunk
- `PARALLEL_CHUNK_RENDERS = 4` parallel chunk renders
- `FFMPEG_PRESET = 'fast'` (better compression than ultrafast)
- `FFMPEG_CRF = '26'` (good quality, reasonable file size)

**Large Video Upload:**
- Videos >50MB use streaming upload via REST API (avoids memory exhaustion)
- `fs.createReadStream()` streams directly to Supabase (no full file in RAM)
- Supabase bucket must have file size limit set (default 50MB, increase to 5GB for Pro)

**SSE Progress Stages:**
- Downloading (5-25%), Preparing (30%), Rendering chunks (30-70%), Concatenating (72%), Audio mux (75%), Uploading (85-100%)
- 5-second keepalive heartbeat prevents connection timeout

**Key files:**
- `render-api/src/routes/render-video.ts`: FFmpeg rendering endpoint
- `src/lib/fcpxmlGenerator.ts`: Client-side FCPXML generation for NLE import
- `src/lib/api.ts`: `renderVideoStreaming()` with SSE progress parsing
- `public/overlays/embers.mp4`: Embers overlay asset

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

### Audio generation "Failed to generate audio" or "No response received"
- **Railway container killed mid-process (SIGTERM in logs)**:
  - Symptom: Frontend shows "No response received", Railway logs show "Stopping Container" / "npm error signal SIGTERM"
  - Cause: Memory exhaustion (OOM kill) from accumulating all audio chunks before concatenation
  - Solution: Uses incremental concatenation (see line 1527 in `generate-audio.ts`)
  - All 10 RunPod workers utilized concurrently (`MAX_CONCURRENT_SEGMENTS=10`)
  - Node.js uses memory-optimized flags: `--max-old-space-size=4096 --optimize-for-size --gc-interval=100`
- Check if `audioUrl` is being returned (backend must concatenate segments)
- Verify `RUNPOD_API_KEY` is set on Railway
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
- Segments use parallel processing (6 concurrent segments matching 6 RunPod workers)
- If all RunPod workers busy → check worker allocation in RunPod dashboard (6 audio + 4 images = 10 total)
- Railway charges only for actual usage time

### Audio timeouts on long scripts
- 5-minute timeout per TTS job should handle most cases
- For very long scripts (1000+ words), processing time increases linearly
- Check RunPod worker logs: `npm run monitor:runpod:errors`
- If retry attempts exhausted, individual chunks are skipped (not fatal)

### Audio quality issues (garbled transcriptions, silence gaps, unintelligible speech)
- **Symptom:** Audio has 1-second silence gaps, garbled/unintelligible speech, poor transcription quality
- **Root cause:** Voice sample format incompatibility
  - ChatterboxTTS requires WAV format base64 for `reference_audio_base64`
  - MP3 voice samples caused intermittent TTS failures → silence gaps → garbled audio
- **Solution (implemented):** Auto-convert MP3→WAV before TTS (line 819 in `generate-audio.ts`)
  - Uses ffmpeg to convert any non-WAV format to 24000Hz mono 16-bit WAV
  - Matches ChatterboxTTS output format exactly
  - Logs show: "⚠️ Voice sample is MP3 format. ChatterboxTTS requires WAV - will convert."
- **Voice sample quality** best practices:
  - Minimum 5 seconds duration (warns if <3s)
  - Minimum 16kHz sample rate (warns if <16kHz)
  - Clear speech, no background noise
  - Formal narration style matching content
- Check Railway logs for voice sample diagnostics (format, duration, sample rate, warnings)
- **Pronunciation fixes**: Add difficult words to `PRONUNCIATION_FIXES` dictionary in `generate-audio.ts`
- **Test without voice cloning**: Generate short test without voice sample to isolate TTS model vs. voice sample issues

### Dead air or unwanted narration of headers/formatting
- Usually caused by markdown headers, hashtags, or section markers not being fully removed
- Symptoms:
  - Dead air/silence: Headers removed but left blank lines
  - Narrating formatting: TTS reads "#TheMedievalTavern", "OPENING", "**bold text**"
- Verify script cleaning removes:
  - Entire lines starting with `#` (both `#Hashtag` and `# Title`)
  - ALL CAPS section headers (e.g., `OPENING`, `CONCLUSION`)
  - Inline hashtags and markdown formatting markers
- Check Railway logs for "Cleaned script: removed X words" message
- Headers like `# Title`, `## Subtitle`, or `#TheMedievalTavern` should be completely stripped

### Post-processing errors ("Cannot find ffprobe")
- Requires both `ffmpeg-static` AND `ffprobe-static` packages
- Install: `npm install ffprobe-static @types/ffprobe-static`
- Configure: `ffmpeg.setFfprobePath(ffprobeStatic.path)`

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
Audio segments: `{projectId}/voiceover-segment-{1-10}.wav`
Combined audio: `{projectId}/voiceover.wav`
Rendered video: `{projectId}/video.mp4` (with embers overlay)

## Default Settings

New projects initialize with:
- Voice sample: `https://historygenai.netlify.app/voices/clone_voice.mp3` (set in `src/pages/Index.tsx`)
- Script template: `template-a`
- AI model: `claude-sonnet-4-5`
- Word count: 1000, Image count: 10, Speed: 1x

**Full Automation Mode** (`settings.fullAutomation`):
- Auto-confirms each pipeline step without user review
- Ends with embers video render (not basic)
- Triggered via Settings popover toggle

## Security

**SSRF Protection** (`render-api/src/routes/generate-audio.ts`):
- Voice sample URLs validated against allowlist
- Allowed domains: `supabase.co`, `supabase.com`, `historygenai.netlify.app`
- Blocks localhost, private IPs, non-HTTPS
