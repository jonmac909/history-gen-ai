# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Augmented Coding Patterns (ACP)

> Teaching AI what you would do - externalizing reasoning step by step so the agent can pick it up and run with it.

### Ground Rules

**Communication:**
- Be extremely succinct - avoid verbose explanations
- One question at a time - never overwhelm with multiple questions
- Warn proactively if you detect potential issues or mistakes

**Process:**
- Work in small, verifiable steps - never make large changes at once
- State expectations before running code (Hypothesize pattern)
- Run tests before AND after changes
- Commit frequently at stable checkpoints
- Ask "what would you recommend?" before proposing solutions (Reverse Direction)

**Context Management:**
- When context gets large, summarize and save to files
- Focus on one task at a time
- Track progress using the TodoWrite tool

### Key Patterns

| Pattern | Description |
|---------|-------------|
| **Hypothesize** | State expectations before running code: "I expect this to fail with X because Y" |
| **Reverse Direction** | Ask "what would you recommend?" instead of telling the solution |
| **Test First** | No production code without a failing test; tests provide feedback |
| **One Problem at a Time** | Break big steps into smaller ones; solve one before moving to next |
| **Cross-Context Memory** | Use persistent files (`memory/goal.md`, `memory/state.md`) for state |
| **Stop** | When things go wrong, stop immediately; don't let bad output contaminate context |
| **Feedback Flip** | After generating output, immediately review: "Did I miss anything? Any issues?" |
| **Semantic Zoom** | Adjust detail level: zoomed out for architecture, zoomed in for line-by-line |
| **Split Process** | When processes are too long, break into smaller files with orchestrator |
| **Refactor Guard** | Make smallest change → AI review → run tests → commit if safe |
| **Algorithmify** | Automate repetitive tasks with scripts; deterministic beats stochastic |
| **CLI First** | Prefer command-line tools; text in/out matches LLM nature |
| **Knowledge Checkpoint** | Save important learnings to `memory/learnings/*.md` |

### Process Files

Reference these for structured workflows:
- `process/tdd.md` - TDD red-green-refactor cycle
- `process/feature.md` - New feature workflow
- `process/bugfix.md` - Bug investigation workflow

### Memory Files

Update these as work progresses:
- `memory/goal.md` - Current objective and task list
- `memory/state.md` - TDD phase, blockers, current task
- `memory/learnings/` - Decisions and knowledge to preserve

### Anti-Patterns to Avoid

| Anti-Pattern | Description |
|--------------|-------------|
| AI Slop | Never accept low-quality output without review |
| Answer Injection | Don't embed expected answers in prompts |
| Distracted Agent | Don't overload with too much context or tasks |
| Flying Blind | Never work without tests or feedback mechanisms |
| Perfect Recall Fallacy | Don't assume AI remembers earlier conversation |
| Silent Misalignment | Always verify AI understanding matches intent |
| Sunk Cost | Know when to stop and start fresh |
| Tell Me a Lie | Always verify AI claims - it hallucinates confidently |
| Unvalidated Leaps | Never allow large changes without incremental validation |

### AI Limitations

| Obstacle | Mitigation |
|----------|------------|
| Black Box (can't see reasoning) | Use hypothesize pattern, state expectations |
| Cannot Learn (forgets between sessions) | Cross-context memory files |
| Compliance Bias (tends to agree) | Ask for alternatives, use reverse direction |
| Context Rot (earlier context fades) | Save to files, fresh contexts |
| Degrades Under Complexity | Split into smaller tasks |
| Limited Context (fixed window) | Manage context actively, summarize |
| Limited Focus | One thing at a time |
| Non-Determinism | Use tests for validation |
| Hallucinations | Always verify claims |

### TDD ZOMBIES (Test Order)

| Letter | Meaning | Example |
|--------|---------|---------|
| Z | Zero | Empty list, null, zero |
| O | One | Single item, one user |
| M | Many | Multiple items, edge cases |
| B | Boundary | Min/max values, limits |
| I | Interface | Public API contracts |
| E | Exception | Error handling, failures |
| S | Simple | Happy path scenarios |

### 3-Layer Architecture (DEO)

When automations emerge, use this pattern:

| Layer | Location | Purpose |
|-------|----------|---------|
| **Directives** | `directives/` | SOPs in Markdown defining goals, inputs, tools, outputs, edge cases |
| **Orchestration** | You/Claude | Read directives, call execution scripts in order, handle errors |
| **Execution** | `execution/` | Deterministic Python scripts for API calls, data processing, file operations |

**Key principles:**
- **Push complexity into deterministic code** - 90% accuracy per step = 59% success over 5 steps
- **Self-annealing loop** - When something breaks: Fix → Update script → Test → Update directive → System is stronger
- **Check for existing tools first** - Before writing a script, check `execution/` and the directive
- **Deliverables vs Intermediates** - Deliverables go to cloud/user; intermediates go to `.tmp/` (gitignored)

### Directory Structure (ACP + DEO)

```
project/
├── CLAUDE.md              # Ground rules (this file)
├── process/               # ACP: Workflow files
│   ├── tdd.md            # TDD red-green-refactor
│   ├── feature.md        # New feature workflow
│   └── bugfix.md         # Bug investigation
├── docs/
│   ├── architecture.md   # System overview
│   ├── decisions.md      # ADRs - why we chose X over Y
│   └── requirements.md   # Current requirements
├── memory/
│   ├── goal.md           # Current goal and tasks
│   ├── state.md          # Current state indicator
│   └── learnings/        # Accumulated knowledge
├── directives/           # DEO: SOPs (add when needed)
├── execution/            # DEO: Scripts (add when needed)
└── .tmp/                 # Intermediate files (gitignored)
```

---

## Project Overview

HistoryGen AI generates AI-powered historical video content from YouTube URLs. It processes transcripts, rewrites them into scripts, generates voice-cloned audio (10 segments with individual regeneration), creates captions, and produces AI images with timing-based filenames.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend API: Express + TypeScript on Railway (long-running operations, usage-based pricing)
- Quick Functions: Supabase Edge Functions (Deno)
- Storage: Supabase Storage
- TTS: RunPod serverless with Fish Speech OpenAudio S1-mini voice cloning
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
| `/generate-audio` | Voice cloning TTS, splits into 10 segments, returns combined + individual URLs |
| `/generate-audio/segment` | Regenerate a single audio segment |
| `/generate-audio/recombine` | Re-concatenate segments after regeneration |
| `/generate-images` | RunPod Z-Image with rolling concurrency (4 workers max) |
| `/generate-captions` | Whisper transcription with WAV chunking |
| `/get-youtube-transcript` | YouTube transcript via Supadata API |
| `/render-video` | FFmpeg video rendering (no captions), SSE progress |
| `/youtube-upload` | YouTube upload with resumable chunks, SSE progress |
| `/youtube-upload/auth` | Exchange OAuth code for tokens |
| `/youtube-upload/token` | Refresh access token |

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
3. **Audio Generation** (10 segments with voice cloning) → Review Captions
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
  - **YouTube Upload**: Direct upload to YouTube as private draft with thumbnail selection

### Audio Generation Architecture

**Uses parallel processing with 10 segments to match Fish Speech RunPod worker allocation.**

- Script split into **10 segments at sentence boundaries** (never mid-sentence)
- **All 10 segments processed in parallel** (utilizing 10 RunPod workers)
- Each segment's chunks processed **sequentially** within the worker (avoids memory issues)
- Voice sample sent with each TTS job (10-30 seconds recommended)
- Individual segment WAVs uploaded, then concatenated into combined file
- **Repetition Prevention**:
  - **Primary: TTS-level** - Fish Speech has built-in `repetition_penalty: 1.2`
  - **Secondary: Proactive text cleaning** - `removeTextRepetitions()` removes duplicate sentences BEFORE TTS (70% Jaccard similarity OR 80% containment)
- Response includes both `audioUrl` (combined) and `segments[]` (for regeneration)
- Frontend `AudioSegmentsPreviewModal` shows "Play All" (combined) + individual segment players with regeneration

**Key constants** in `render-api/src/routes/generate-audio.ts`:
- `MAX_TTS_CHUNK_LENGTH = 250` chars per TTS chunk
- `DEFAULT_SEGMENT_COUNT = 10` segments (match Fish Speech RunPod workers)
- `MAX_CONCURRENT_SEGMENTS = 10` (parallel processing)
- `TTS_JOB_POLL_INTERVAL_INITIAL = 250` ms (fast initial polling)
- `TTS_JOB_POLL_INTERVAL_MAX = 1000` ms (adaptive polling cap)
- `RETRY_MAX_ATTEMPTS = 3` (exponential backoff: 1s → 2s → 4s, max 10s)
- `PRONUNCIATION_FIXES` dictionary for phonetic replacements of commonly mispronounced words

**Polling & Retry Logic:**
- 5-minute timeout per TTS job (300 attempts)
- Adaptive polling: starts at 250ms, increases to 1s max after 3 attempts
- Uses RunPod's `delayTime` hint when available (capped at 1.5s)
- Exponential backoff retry for failed chunks (3 attempts max)
- Continues processing if individual chunks fail (skips instead of failing entire job)

**Text Normalization & Cleaning:**
- **Script cleaning** removes markdown headers, scene markers, and metadata BEFORE TTS:
  - Removes entire lines starting with `#` (both `#TheMedievalTavern` and `# Title`)
  - Removes standalone ALL CAPS lines (section headers like `OPENING`, `CONCLUSION`)
  - Removes markdown horizontal rules (`---`, `***`, `___`) - these cause TTS silence
  - Removes inline hashtags (e.g., `#TheMedievalTavern` in middle of text)
  - Removes markdown bold/italic markers `*`, `**`, `***` (keeps text content)
  - Removes parenthetical time markers like `(5-10 minutes)`
  - Removes scene markers `[SCENE X]` and other bracketed content
- `normalizeText()` converts smart quotes/dashes to ASCII BEFORE removing non-ASCII
- **Number-to-words conversion**: "ACT 5" → "Act Five", years like "1347" → "thirteen forty-seven"
- **Pronunciation fixes**: Dictionary-based phonetic replacements for difficult proper nouns (e.g., "Byzantine" → "Biz-an-tine")

**Individual Segment Regeneration:**
- POST `/generate-audio/segment` regenerates a single segment
- Frontend calls `onRegenerate(segmentIndex)` to regenerate specific segment
- POST `/generate-audio/recombine` re-concatenates segments after regeneration

### RunPod Endpoints

**Fish Speech OpenAudio S1-mini** (Endpoint: `0tcsa5htuoq0go`):
- Input: `{ text, reference_audio_base64 }`
  - Voice sample: 10-30 seconds recommended for best quality
  - MP3/other formats auto-converted to WAV via ffmpeg
  - Fish Speech accepts various sample rates (no strict resampling required)
- Output: 24000Hz mono 16-bit WAV
- 2000 char limit per request
- GitHub repo: `jonmac909/fish-speech-runpod`
- **TTS Generation Parameters** (in `handler.py`):
  - `temperature: 0.7` - Balanced expressiveness
  - `top_p: 0.8` - Nucleus sampling
  - `repetition_penalty: 1.2` - Prevents phrase repetitions
  - `normalize: True` - Text normalization for numbers
  - `chunk_length: 200` - Processing chunk size
- **Model Info**:
  - OpenAudio S1-mini: 0.5B parameters
  - Quality: 0.008 WER, 0.004 CER on English
  - ~150 tokens/second on RTX 4090

**Z-Image-Turbo**:
- Input: `{ prompt, quality: "basic"|"high", aspectRatio: "16:9"|"1:1"|"9:16" }`
- Dimensions must be divisible by 16
- Uses `guidance_scale=0.0` (no negative prompts)

**RunPod Worker Allocation**:
- **10 workers for audio (Fish Speech)**, **4 workers for images (Z-Image)**
- Set in RunPod dashboard endpoint settings
- **Memory optimization**: Audio processing uses **incremental concatenation** to prevent Railway OOM kills
  - Incrementally concatenates chunks (only 1 combined buffer per segment)
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

**Server-side FFmpeg rendering with chunked processing and smoke+embers overlay.**

**Chunked Rendering Pipeline:**
1. Download audio + images + overlay files from Supabase/Netlify
2. Split images into chunks (25 images per chunk)
3. Render each chunk with two-pass approach:
   - Pass 1: Images → raw chunk video (scale, letterbox)
   - Pass 2: Apply smoke (multiply blend) + embers (colorkey overlay)
4. Concatenate chunks (fast copy, no re-encode)
5. Add audio (fast mux)
6. Upload final MP4 to Supabase

**Smoke+Embers Overlay System:**
- **Two-overlay approach** to avoid color tint issues:
  - `smoke_gray.mp4`: Inverted grayscale smoke (white background, dark smoke)
  - `embers.mp4`: Orange embers on pure black background
- **Filter chain** (for `smoke_embers` effect):
  ```
  [smoke]colorchannelmixer → grayscale → [base]multiply blend → [embers]colorkey → overlay
  ```
  - Smoke: Convert to grayscale, multiply blend darkens image naturally
  - Embers: Colorkey removes black, overlays bright particles on top
- **Why two overlays?** Single overlays with colored smoke cause purple/green tint artifacts
- Overlay files served from Netlify: `https://historygenai.netlify.app/overlays/`
- Applied per-chunk using concat demuxer (NOT -stream_loop which crashes on long videos)
- Graceful fallback: if overlay pass fails, uses raw chunk without effects

**Key constants** in `render-api/src/routes/render-video.ts`:
- `IMAGES_PER_CHUNK = 25` images per chunk
- `PARALLEL_CHUNK_RENDERS = 4` parallel chunk renders
- `FFMPEG_PRESET = 'fast'` (better compression than ultrafast)
- `FFMPEG_CRF = '26'` (good quality, reasonable file size)
- Colorkey settings: `similarity=0.2:blend=0.2` for embers

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
- `public/overlays/smoke_gray.mp4`: Grayscale smoke overlay (for multiply blend)
- `public/overlays/embers.mp4`: Embers overlay (for colorkey overlay)

### YouTube Upload Architecture

**Direct upload to YouTube with OAuth 2.0 and resumable uploads.**

**OAuth 2.0 Flow:**
1. User clicks "Upload to YouTube" → Opens popup with Google OAuth consent screen
2. User grants `youtube.upload` scope → Popup receives authorization code
3. Popup posts code to parent window via `postMessage`
4. Frontend exchanges code for tokens via `/youtube-upload/auth`
5. Refresh token stored in Supabase, access token used for upload
6. Access token refreshed via `/youtube-upload/token` when expired

**Upload Flow:**
1. Frontend calls `uploadToYouTube()` with video URL, metadata, and optional thumbnail
2. Backend downloads video from Supabase storage
3. Initiates resumable upload session with YouTube Data API v3
4. Uploads video in 5MB chunks with progress streaming via SSE
5. Sets video metadata (title, description, tags, category, privacy)
6. Optionally uploads custom thumbnail via Thumbnails API
7. Returns YouTube video ID and URLs (watch + studio)

**Key files:**
- `render-api/src/routes/youtube-upload.ts`: Backend upload endpoint
- `src/components/YouTubeUploadModal.tsx`: Upload form with thumbnail selection
- `src/lib/youtubeAuth.ts`: OAuth popup flow and token management
- `src/pages/YouTubeOAuthCallback.tsx`: OAuth callback handler (popup)
- `src/lib/api.ts`: `uploadToYouTube()` SSE client

**Upload Parameters:**
- `title` (required): Video title (max 100 chars)
- `description`: Video description
- `tags`: Array of keyword tags
- `categoryId`: YouTube category (default: "27" = Education)
- `privacyStatus`: "private" | "unlisted" (public requires verification)
- `publishAt`: ISO timestamp for scheduled publishing
- `thumbnailUrl`: URL of generated thumbnail to set

**Thumbnail Selection:**
- Previously generated thumbnails passed to modal via `thumbnails` prop
- User can select any thumbnail or leave unselected (YouTube auto-generates)
- Selected thumbnail uploaded after video via YouTube Thumbnails API
- Supports JPEG, PNG, GIF, BMP formats (max 2MB)

**Privacy Options:**
- **Private (Draft)**: Only visible to uploader, review in YouTube Studio
- **Unlisted**: Shareable via link but not in search/recommendations
- **Scheduled**: Private until `publishAt` timestamp, then public

**SSE Progress Events:**
- `progress`: Upload percentage (0-100)
- `complete`: Success with `{ videoId, youtubeUrl, studioUrl }`
- `error`: Upload failed with error message

**Environment Variables (Railway):**
```
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_REDIRECT_URI=https://historygenai.netlify.app/oauth/youtube/callback
```

**Supabase Table:** `youtube_tokens`
- Stores encrypted refresh tokens for token refresh flow
- Single-row table (app uses shared password auth)

## Configuration

### Frontend Environment (`.env`)
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
VITE_RENDER_API_URL=<railway-production-url>
VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>
```

### Railway API Environment Variables
Set these in Railway dashboard → Variables:
```
ANTHROPIC_API_KEY=<claude-api-key>
SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RUNPOD_API_KEY=<runpod-key>
RUNPOD_ZIMAGE_ENDPOINT_ID=<z-image-endpoint>
RUNPOD_ENDPOINT_ID=0tcsa5htuoq0go
OPENAI_API_KEY=<openai-key-for-whisper>
SUPADATA_API_KEY=<supadata-key-for-youtube>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://historygenai.netlify.app/oauth/youtube/callback
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

**Fish Speech:** GitHub integration auto-rebuilds `jonmac909/fish-speech-runpod` (5-10 min)

## Common Issues

### Audio generation "Failed to generate audio" or "No response received"
- **Railway container killed mid-process (SIGTERM in logs)**:
  - Symptom: Frontend shows "No response received", Railway logs show "Stopping Container" / "npm error signal SIGTERM"
  - Cause: Memory exhaustion (OOM kill) from accumulating all audio chunks before concatenation
  - Solution: Uses incremental concatenation in `generate-audio.ts`
  - All 10 RunPod workers utilized concurrently (`MAX_CONCURRENT_SEGMENTS=10`)
  - Node.js uses memory-optimized flags: `--max-old-space-size=4096 --optimize-for-size --gc-interval=100`
- Check if `audioUrl` is being returned (backend must concatenate segments)
- Verify `RUNPOD_API_KEY` is set on Railway
- Frontend expects both `audioUrl` (combined) AND `segments[]` array

### Captions too short / wrong duration
- Captions must use combined `audioUrl`, not `segments[0].audioUrl`
- Check `pendingAudioUrl` is set from `audioRes.audioUrl`, not first segment
- WAV parsing must find actual 'data' chunk (not assume 44-byte header)
- **Sample rate**: Fish Speech outputs 24000Hz
  - `createWavFromPcm()` must use actual audio format from `extractPcmFromWav()`
- See `extractPcmFromWav()` and `createWavFromPcm()` in `generate-captions.ts`

### Audio preview too short
- `AudioSegmentsPreviewModal` needs `combinedAudioUrl` and `totalDuration` props
- Modal should show "Play All" player for combined audio

### Audio generation slow or workers at capacity
- Segments use parallel processing (10 concurrent segments matching 10 RunPod workers)
- If all RunPod workers busy → check worker allocation in RunPod dashboard (10 audio + 4 images = 14 total)
- Railway charges only for actual usage time

### Audio timeouts on long scripts
- 5-minute timeout per TTS job should handle most cases
- For very long scripts (1000+ words), processing time increases linearly
- Check RunPod worker logs: `npm run monitor:runpod:errors`
- If retry attempts exhausted, individual chunks are skipped (not fatal)

### Audio quality issues
- **Voice sample quality** best practices:
  - 10-30 seconds duration recommended for best voice cloning
  - Clear speech, no background noise
  - Formal narration style matching content
- Check Railway logs for voice sample diagnostics (format, duration, sample rate, warnings)
- **Pronunciation fixes**: Add difficult words to `PRONUNCIATION_FIXES` dictionary in `generate-audio.ts`
- Fish Speech has built-in `repetition_penalty: 1.2` to prevent repetition issues

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

### YouTube upload fails or OAuth errors
- **"redirect_uri_mismatch" error**: Verify `GOOGLE_REDIRECT_URI` matches exactly in:
  - Railway environment variables
  - Google Cloud Console → Credentials → Authorized redirect URIs
  - Must include full path: `https://historygenai.netlify.app/oauth/youtube/callback`
- **"access_denied" error**: User must be added as test user in Google Cloud Console
  - Go to OAuth consent screen → Test users → Add your Google email
  - Or publish app for public access (requires verification)
- **Token refresh fails**: Check `youtube_tokens` table in Supabase has valid refresh token
  - Tokens expire if user revokes access in Google Account settings
  - Solution: Disconnect and reconnect YouTube account
- **Upload quota exceeded**: YouTube API has 10,000 units/day default
  - Video upload costs 1,600 units (~6 videos/day)
  - Request quota increase in Google Cloud Console if needed
- **Thumbnail upload fails**: Non-blocking, video still uploads successfully
  - Check thumbnail URL is accessible and < 2MB
  - Supported formats: JPEG, PNG, GIF, BMP

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
