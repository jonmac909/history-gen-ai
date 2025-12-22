# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HistoryGen AI generates AI-powered historical video content from YouTube URLs. It processes transcripts, rewrites them into scripts, generates voice-cloned audio (6 segments), creates captions, and produces AI images with timing-based filenames.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend API: Express + TypeScript on Render (long-running operations)
- Quick Functions: Supabase Edge Functions (Deno)
- Storage: Supabase Storage
- TTS: RunPod serverless with ChatterboxTurboTTS voice cloning
- Image Generation: RunPod serverless with Z-Image-Turbo
- Deployment: Netlify (frontend), Render (API), Supabase (storage + quick functions)

## Development Commands

### Frontend
```bash
npm i                    # Install dependencies
npm run dev              # Start dev server (http://localhost:8080)
npm run build            # Production build
npm run lint             # Run ESLint
npm test                 # Run tests in watch mode
npm run test:run         # Run tests once (for CI)
npm run test:coverage    # Run tests with coverage
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

### Audio Generation Architecture

**Critical: Uses sequential processing to avoid RunPod memory issues.**

- Script split into 6 equal segments by word count
- Each segment processed sequentially (NOT parallel)
- Voice sample (5-10MB base64) sent with each TTS job
- Individual segment WAVs uploaded, then concatenated into combined file
- Response includes both `audioUrl` (combined) and `segments[]` (for regeneration)

Key constants in `render-api/src/routes/generate-audio.ts`:
- `MAX_TTS_CHUNK_LENGTH = 500` chars per TTS chunk
- `DEFAULT_SEGMENT_COUNT = 6` segments
- Sequential processing prevents "Ran out of memory (>2GB)" errors

### RunPod Endpoints

**ChatterboxTurboTTS** (Endpoint: `eitsgz3gndkh3s`):
- Input: `{ text, reference_audio_base64 }`
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

### Audio stuck at 15% or memory errors
- DO NOT parallelize audio generation (causes memory issues)
- Workers at capacity → increase max workers in RunPod

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
