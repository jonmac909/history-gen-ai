# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HistoryGen AI generates AI-powered historical video content from YouTube URLs. It processes transcripts, rewrites them into scripts, generates voice-cloned audio, creates captions, and produces AI images with timing-based filenames for video editing.

**Stack:**
- Frontend: React + TypeScript + Vite + shadcn-ui + Tailwind CSS
- Backend: Supabase Edge Functions (Deno)
- Storage: Supabase Storage (audio, scripts, captions, images)
- TTS: RunPod serverless with ChatterboxTurboTTS voice cloning
- Image Generation: RunPod serverless with Z-Image-Turbo
- Deployment: Netlify (frontend), Supabase (backend), RunPod (AI workers)

## Development Commands

```bash
npm i                    # Install dependencies
npm run dev              # Start dev server (http://localhost:8080)
npm run build            # Production build
npm run lint             # Run ESLint

# Supabase function deployment (requires SUPABASE_ACCESS_TOKEN)
npx supabase functions deploy <function-name>

# Alternative: Deploy via Supabase Dashboard if Docker issues
# https://supabase.com/dashboard/project/udqfdeoullsxttqguupz/functions

# RunPod monitoring
npm run monitor:runpod          # View RunPod logs
npm run monitor:runpod:watch    # Watch logs in real-time
npm run monitor:runpod:errors   # Show errors only
```

## Architecture

### Generation Pipeline (`src/pages/Index.tsx`)

Multi-step pipeline with user review at each stage:

1. **Transcript Fetch** → User reviews script
2. **Script Generation** (streaming) → User reviews audio
3. **Audio Generation** (voice cloning) → User reviews captions
4. **Captions Generation** → AI generates scene descriptions
5. **Image Prompts** (Claude analyzes script + SRT timing) → Images generated
6. **Image Generation** (streaming, parallel jobs) → Final results

### Supabase Edge Functions (`supabase/functions/`)

| Function | Purpose |
|----------|---------|
| `get-youtube-transcript` | Fetches YouTube captions |
| `rewrite-script` | Streams script generation with word count progress |
| `generate-audio` | Voice cloning TTS via RunPod, splits text into 180-char chunks |
| `generate-captions` | Creates SRT files from audio using Whisper |
| `generate-image-prompts` | Uses Claude API to create visual scene descriptions synchronized with SRT timing |
| `generate-images` | Parallel RunPod jobs for Z-Image, uploads to Supabase with timing-based filenames |
| `generate-video` | Creates EDL/CSV timeline files |
| `download-images-zip` | Packages generated images into downloadable ZIP |
| `get-elevenlabs-voices` | Lists available ElevenLabs voices (alternative TTS) |

### Frontend API Layer (`src/lib/api.ts`)

All Supabase function calls go through `src/lib/api.ts`. Key exports:
- `getYouTubeTranscript()` - Fetch transcript
- `rewriteScriptStreaming()` - Stream script with progress callbacks
- `generateAudioStreaming()` - Stream audio generation with progress
- `generateImagePrompts()` - Get AI scene descriptions with timing
- `generateImagesStreaming()` - Parallel image generation with progress
- `generateCaptions()` - Create SRT from audio

### Image Generation Flow

1. `generate-image-prompts` receives script + SRT content
2. Claude AI analyzes narration and generates visual scene descriptions
3. Returns `ImagePromptWithTiming[]` with `startTime`/`endTime` in HH-MM-SS format
4. `generate-images` receives prompts with timing info
5. Creates parallel RunPod jobs for Z-Image-Turbo
6. Images uploaded to `{projectId}/images/image_001_00-00-00_to_00-00-45.png`

### RunPod Endpoints

**ChatterboxTurboTTS** (`chatterbox/` directory, separate repo `jonmac909/chatterbox`):
- Endpoint ID: `eitsgz3gndkh3s`
- Input: `{ text, reference_audio_base64 }` (voice sample required for cloning)
- 180 character limit per chunk
- Requires 5+ second voice samples

**Z-Image-Turbo** (`z-image-runpod/` directory):
- Model: Z-Image-Turbo (6B params)
- Input: `{ prompt, quality: "basic"|"high", aspectRatio: "16:9"|"1:1"|"9:16" }`
- Output: `{ image_base64, width, height, steps }`
- Default resolution: 1792×1008 (16:9, both dimensions divisible by 16)
- Uses `guidance_scale=0.0` (no negative prompts supported)
- Requires A6000 GPU (48GB VRAM)

**Claude API** (used in `generate-image-prompts`):
- Model: `claude-sonnet-4-20250514`
- Generates visual scene descriptions from script + SRT timing

## Key Constraints

### Z-Image-Turbo
- All dimensions must be divisible by 16
- Negative prompts are ignored (`guidance_scale=0.0`)
- For restrictions, use positive framing in style prompt instead

### ChatterboxTurboTTS
- 180 character max per chunk (text auto-split)
- Voice samples must be 5+ seconds
- PyTorch/torchvision versions must match exactly (see chatterbox repo)

## Configuration

**Environment Variables (`.env`):**
```
VITE_SUPABASE_URL=https://udqfdeoullsxttqguupz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<key>
VITE_SUPABASE_PROJECT_ID=udqfdeoullsxttqguupz
```

**Supabase Secrets:**
- `RUNPOD_API_KEY` - RunPod API key
- `RUNPOD_ENDPOINT_ID` - TTS endpoint (default: `eitsgz3gndkh3s`)
- `RUNPOD_ZIMAGE_ENDPOINT_ID` - Z-Image endpoint
- `ANTHROPIC_API_KEY` - For `generate-image-prompts` function

**Storage Buckets:**
- `voice-samples` - User uploaded voice samples (must be PUBLIC)
- `generated-assets` - All generated content (audio, scripts, captions, images)

## Common Issues

### RunPod workers crashing
- **Exit code 2:** Python import errors or missing dependencies
- **Exit code 1:** Runtime errors like PyTorch/torchvision version mismatch
- Check worker logs in RunPod dashboard for full traceback
- After fixes, push to GitHub - RunPod auto-rebuilds (5-10 min)

### Image generation fails
- Verify `RUNPOD_ZIMAGE_ENDPOINT_ID` is set in Supabase secrets
- Check dimensions are divisible by 16 if using custom sizes
- A6000 GPU required (48GB VRAM)

### Audio stuck at 15%
- Workers at capacity → increase max workers in RunPod
- Endpoint ID mismatch → verify in `generate-audio/index.ts`

### Frontend not updating
- Clear cache: `Cmd+Shift+R` or Incognito
- Check Netlify build status

## Deployment

**Frontend:** Auto-deploys to Netlify on push to `main`

**Supabase Functions:**
- CLI: `npx supabase functions deploy <name>`
- Or manually via Dashboard

**RunPod:**
- TTS: GitHub integration watches `jonmac909/chatterbox`
- Z-Image: Build from `z-image-runpod/`, push to Docker Hub, create serverless endpoint

## File Naming Conventions

Generated images use timing-based filenames for video editing:
```
{projectId}/images/image_001_00-00-00_to_00-00-45.png
{projectId}/images/image_002_00-00-45_to_00-01-30.png
```

Format: `image_{index}_{startTime}_to_{endTime}.png` where times are HH-MM-SS.
