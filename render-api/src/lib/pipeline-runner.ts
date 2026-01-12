/**
 * Pipeline Runner - Server-side orchestrator for full video generation pipeline
 *
 * Runs the complete pipeline for cloning a video:
 * 1. Fetch transcript from source video
 * 2. Generate script from transcript
 * 3. Generate audio (voice cloning)
 * 4. Generate captions
 * 5. Generate clip prompts (5 × 12s video intro)
 * 6. Generate video clips (Seedance 1.5 Pro)
 * 7. Generate image prompts (for remaining duration)
 * 8. Generate images
 * 9. Analyze + generate thumbnail
 * 10. Render video (clips + images)
 * 11. Upload to YouTube (title rewriting done in modal)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

// Base URL for internal API calls - always use localhost to avoid SSL issues
const API_BASE_URL = `http://localhost:${process.env.PORT || 10000}`;

export interface PipelineInput {
  sourceVideoId: string;
  sourceVideoUrl: string;
  originalTitle: string;
  originalThumbnailUrl: string;
  channelName?: string;
  publishAt?: string;  // ISO timestamp for scheduled publish (5 PM PST)
  sourceDurationSeconds?: number;  // Original video duration for matching script length
  targetWordCount?: number;  // Override calculated word count (default: duration * 150 wpm)
}

export interface PipelineResult {
  success: boolean;
  projectId: string;
  clonedTitle?: string;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  error?: string;
  steps: PipelineStepResult[];
}

interface PipelineStepResult {
  step: string;
  success: boolean;
  duration: number;
  error?: string;
  data?: any;
}

type ProgressCallback = (step: string, progress: number, message: string) => void;

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key);
}

// Download image URL and convert to base64
async function downloadImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = await response.buffer();
  return buffer.toString('base64');
}

// Helper to call internal API routes
async function callInternalAPI(
  endpoint: string,
  body: any,
  timeoutMs: number = 300000  // 5 min default
): Promise<any> {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`[Pipeline] Calling ${endpoint}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout calling ${endpoint}`);
    }
    throw error;
  }
}

// Helper for SSE streaming endpoints with real-time progress
async function callStreamingAPI(
  endpoint: string,
  body: any,
  onProgress?: (data: any) => void,
  timeoutMs: number = 600000  // 10 min default
): Promise<any> {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`[Pipeline] Calling streaming ${endpoint}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeout);
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    // Stream SSE events in real-time for progress updates
    let result: any = null;
    let buffer = '';

    // Use Node.js stream API for node-fetch
    const nodeStream = response.body as unknown as NodeJS.ReadableStream;
    if (nodeStream && typeof nodeStream.on === 'function') {
      await new Promise<void>((resolve, reject) => {
        nodeStream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (onProgress) onProgress(data);
                if (data.type === 'complete') {
                  result = data;
                } else if (data.type === 'error') {
                  reject(new Error(data.error || 'Stream error'));
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        });

        nodeStream.on('end', () => {
          // Process remaining buffer
          if (buffer.startsWith('data: ')) {
            try {
              const data = JSON.parse(buffer.slice(6));
              if (onProgress) onProgress(data);
              if (data.type === 'complete') {
                result = data;
              }
            } catch (e) {
              // Ignore
            }
          }
          resolve();
        });

        nodeStream.on('error', reject);
      });
    } else {
      // Fallback for environments without streaming
      const text = await response.text();
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (onProgress) onProgress(data);
            if (data.type === 'complete') {
              result = data;
            } else if (data.type === 'error') {
              throw new Error(data.error || 'Stream error');
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    clearTimeout(timeout);

    if (!result) {
      console.error(`[Pipeline] No complete event received from ${endpoint}`);
      throw new Error(`No complete event received from ${endpoint}`);
    }
    return result;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout calling ${endpoint}`);
    }
    throw error;
  }
}

// Default voice sample URL
const DEFAULT_VOICE_SAMPLE = 'https://autoaigen.com/voices/clone_voice.mp3';

// Auto Poster Template: Complete Histories (template-a)
const COMPLETE_HISTORIES_TEMPLATE = `THESE ARE INSTRUCTIONS FOR YOU - DO NOT INCLUDE ANY OF THIS MARKDOWN FORMATTING IN YOUR OUTPUT!

Your output must be ONLY plain text prose with zero formatting. No #, no **, no section headers, no brackets.

PROJECT INSTRUCTIONS: Complete Histories Sleep-Friendly Video Scripts

PROJECT OVERVIEW:
You are writing 2-3 hour video scripts for "Complete Histories," a YouTube channel that creates long-form historical documentaries designed as sleep-friendly content. These scripts help viewers drift peacefully through history with dreamy, time-travelly narratives.

## CORE VOICE & STYLE (NEVER COMPROMISE THESE)

### Tone
- **Dreamy and time-travelly**: Create a sense of floating through history
- **Meditative, not dramatic**: Avoid urgency, tension spikes, or cliffhangers
- **Contemplative and reflective**: Weave in philosophical observations naturally
- **Reverent without being stiff**: Show wonder and respect for the subject
- **Emotionally restrained**: Handle even tragedy with dignity, not melodrama

### Point of View
- **Primary**: Third person omniscient narrator
- **Secondary**: Second person ("you") for immersion 2-3 times per section
  - "You could walk from the harbor and see..."
  - "Stand in the marketplace and you would hear..."
  - Use this to invite viewers into the scene without forcing participation

### Sentence Structure
- **Flowing, connected sentences**: Ideas link like water moving downstream
- **Varied rhythm**: Mix longer flowing sentences with shorter grounding statements
- **Natural cadence**: Read aloud-friendly, like a bedtime story for adults
- **Example**: "The walls rose stone by stone. Each block was cut to fit its neighbor with a care that made the joint tighter than any mortar could. When rain came, the water ran down the face and found no crack to enter."

### What to AVOID
- Cliffhangers or "But what happens next?!" moments
- Dramatic music cues in writing ("suddenly!", "shockingly!")
- Forced excitement or urgency
- Modern slang or anachronistic language
- Judgment or heavy-handed moralizing
- Questions that demand alert engagement
- Lists with bullet points (use flowing prose instead)
- Excessive bolding, caps, or emphasis

## SENSORY IMMERSION REQUIREMENTS

### Include Every 2-3 Minutes
You must ground viewers with sensory details:

**Smell**: "The air carried salt and cedar and the smoke of evening fires"
**Sound**: "The only sound was the scrape of oars and the low call of a bird that fishes at dusk"
**Touch/Texture**: "The stone was warm underfoot even when the sun had set"
**Temperature**: "The cold spring ran so cold it numbed the hand"
**Taste**: "Bread made from barley on poor days, from wheat when the harvest was strong"
**Light/Color**: "The bronze took the sunset and gave it back in warm bands"

### Sensory Detail Rules
- Be specific, not generic ("cedar smoke" not "smoke")
- Anchor to human experience ("warm enough to ease tired limbs")
- Use comparisons that ground rather than elevate ("like rain on a roof")
- Integrate naturally into narrative flow, never list

STRUCTURAL TEMPLATE (THESE ARE CONTENT GUIDELINES - DO NOT WRITE "OPENING" OR "ACT 1" IN YOUR OUTPUT!):

WARNING: The labels below (OPENING, ACT 1, ACT 2, etc.) are for YOUR reference only.
DO NOT include these labels, numbers, or any brackets/formatting in your actual script.
Write everything as continuous flowing prose narration.

1. OPENING (5-10 minutes) - Begin with:
Good evening and welcome back. Tonight we're [exploring/journeying through/diving into] [TOPIC].

Then include 2-3 contemplative questions woven naturally into the prose:
- What was [this civilization/place/era]?
- Why has [this story] captured imaginations for [X] years?
- How did [key characteristic] shape their world?

Brief preview in flowing language:
We'll explore where [the story] began, what [sources/evidence] tell us, and how [it evolved/fell/transformed] over [time period].

As always, I'd love to know—where in the world are you listening from and what time is it for you? Whether you're here to drift into sleep or to follow the currents of history, I'm glad you're with me.

Now, let's begin.

Opening Tone: 4/10 energy—welcoming but already calm

2. THE BEGINNING (20-30 minutes)
Purpose: Establish the mythic/legendary foundation and earliest origins
IMPORTANT: Do not write "ACT 1" or "THE BEGINNING" as a header - just start the narration

3. THE RISE (30-45 minutes)
Purpose: Show gradual growth and development of civilization
IMPORTANT: Do not write "ACT 2" or "THE RISE" as a header - just continue the narration

4. THE GOLDEN AGE (30-45 minutes)
Purpose: Show peak achievement and prosperity
IMPORTANT: No headers - just continue narrating

5. THE TURNING (20-30 minutes)
Purpose: Show seeds of decline through accumulation of small changes
IMPORTANT: No headers - just continue narrating

6. THE CRISIS (30-40 minutes)
Purpose: The breaking point—war, disaster, or collapse
IMPORTANT: No headers - just continue narrating

7. THE AFTERMATH (20-30 minutes)
Purpose: Survival and immediate legacy
IMPORTANT: No headers - just continue narrating

8. THE LEGACY (30-45 minutes)
Purpose: Historical memory, evidence, and meaning
IMPORTANT: No headers - just continue narrating

9. CLOSING (5 minutes) - End with:
So the tale of [civilization] [how it ends—comes to us, remains in memory, completes its arc].

Include a final sensory image or scene (keep it peaceful), what remains, a final philosophical reflection, optional gentle thanks, and the softest possible end.

Energy Level: 2/10—softest point of entire script

## ESSENTIAL TECHNIQUES

### Repetitive Anchoring
Create hypnotic rhythm with 5-8 anchor phrases repeated throughout.

### Philosophical Breathers
Every 5-10 minutes, pause for 1-3 sentences of reflection.

### Human Scale Zooming
After large-scale events, zoom to individual experience.

### Time Transitions
Smooth: "In the years that followed...", "Generations later...", "The seasons turned and turned again..."`;

// Auto Poster Image Style: Dutch Golden Age (image-a)
const DUTCH_GOLDEN_AGE_STYLE = `Warm classical oil-painting style, inspired by Dutch Golden Age.. Soft, intimate chiaroscuro with lifted shadows and glowing midtones, avoiding harsh contrast. Rich, earthy palette of warm reds, ochres, umbers, and deep teal-blues. Painterly brushwork with visible texture and gentle edges. Quiet, reverent, contemplative mood. Old-world, timeless atmosphere with a sense of stillness, intimacy, and human warmth. Romantic historical painting sensibility with softened realism. Gentle, peaceful tone — not scary, not violent. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation`;

// Intro video clips configuration
const INTRO_CLIP_COUNT = 12;  // 12 video clips at start
const INTRO_CLIP_DURATION = 5;  // 5 seconds each
const INTRO_TOTAL_DURATION = INTRO_CLIP_COUNT * INTRO_CLIP_DURATION;  // 60 seconds total

/**
 * Run the full video generation pipeline
 */
export async function runPipeline(
  input: PipelineInput,
  onProgress?: ProgressCallback
): Promise<PipelineResult> {
  const projectId = randomUUID();
  const steps: PipelineStepResult[] = [];
  const supabase = getSupabaseClient();

  const reportProgress = (step: string, progress: number, message: string) => {
    console.log(`[Pipeline] ${step}: ${message} (${progress}%)`);
    if (onProgress) onProgress(step, progress, message);
  };

  try {
    reportProgress('init', 0, 'Starting pipeline...');

    // Step 1: Fetch transcript
    reportProgress('transcript', 5, 'Fetching source transcript...');
    const transcriptStart = Date.now();
    let transcript: string;
    try {
      const transcriptRes = await callInternalAPI('/get-youtube-transcript', {
        url: input.sourceVideoUrl,  // Route expects 'url', not 'videoId'
      });
      transcript = transcriptRes.transcript;
      steps.push({
        step: 'transcript',
        success: true,
        duration: Date.now() - transcriptStart,
        data: { length: transcript.length },
      });
    } catch (error: any) {
      steps.push({ step: 'transcript', success: false, duration: Date.now() - transcriptStart, error: error.message });
      throw new Error(`Failed to fetch transcript: ${error.message}`);
    }

    // Use original title (title rewriting happens in YouTube upload modal)
    const clonedTitle = input.originalTitle;

    // Step 2: Generate script (streaming)
    reportProgress('script', 15, 'Generating script...');
    const scriptStart = Date.now();
    let script: string;
    let calculatedImageCount: number = 10;  // Will be recalculated based on actual word count

    // Calculate target word count based on source video duration (or use manual override)
    // 150 words/minute is typical documentary narration pace
    const WORDS_PER_MINUTE = 150;
    const durationMinutes = input.sourceDurationSeconds ? Math.round(input.sourceDurationSeconds / 60) : 20;
    const calculatedWordCount = durationMinutes * WORDS_PER_MINUTE;
    const targetWordCount = input.targetWordCount || calculatedWordCount;
    console.log(`[Pipeline] Target word count: ${targetWordCount}${input.targetWordCount ? ' (manual override)' : ` (${durationMinutes} min @ ${WORDS_PER_MINUTE} wpm)`}`);

    try {
      const scriptRes = await callStreamingAPI('/rewrite-script', {
        transcript,
        projectId,
        voiceStyle: '(sincere) (soft tone)',
        wordCount: targetWordCount,
        template: COMPLETE_HISTORIES_TEMPLATE,  // Use Complete Histories template for Auto Poster
        stream: true,  // Required for SSE mode
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('script', 15 + Math.round(data.progress * 0.1), `Generating script... ${data.progress}%`);
        }
      }, 1800000);  // 30 min timeout for very long scripts (200+ min videos)
      script = scriptRes.script;
      const actualWordCount = script.split(/\s+/).length;
      steps.push({
        step: 'script',
        success: true,
        duration: Date.now() - scriptStart,
        data: { wordCount: actualWordCount },
      });

      // Calculate image count: 1 image per 100 words (min 10, max 300)
      calculatedImageCount = Math.min(300, Math.max(10, Math.round(actualWordCount / 100)));
      console.log(`[Pipeline] Image count: ${calculatedImageCount} (${actualWordCount} words / 100)`);
    } catch (error: any) {
      steps.push({ step: 'script', success: false, duration: Date.now() - scriptStart, error: error.message });
      throw new Error(`Failed to generate script: ${error.message}`);
    }

    // Step 4: Generate audio (streaming)
    reportProgress('audio', 25, 'Generating audio...');
    const audioStart = Date.now();
    let audioUrl: string;
    let audioDuration: number;

    // Debug: Log script info before audio generation
    console.log(`[Pipeline] Script length: ${script?.length || 0} chars, type: ${typeof script}`);
    console.log(`[Pipeline] Script first 500 chars: "${script?.substring(0, 500)}..."`);
    console.log(`[Pipeline] Script last 200 chars: "...${script?.slice(-200)}"`);
    if (!script || script.trim().length < 100) {
      console.error(`[Pipeline] ERROR: Script is empty or too short! Length: ${script?.length || 0}`);
    }

    try {
      const audioRes = await callStreamingAPI('/generate-audio', {
        script,
        projectId,
        voiceSampleUrl: DEFAULT_VOICE_SAMPLE,
        voiceStyle: '(sincere) (soft tone)',
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('audio', 25 + Math.round(data.progress * 0.15), `Generating audio... ${data.progress}%`);
        }
      }, 1200000);  // 20 min timeout
      audioUrl = audioRes.audioUrl;
      audioDuration = audioRes.totalDuration;
      steps.push({
        step: 'audio',
        success: true,
        duration: Date.now() - audioStart,
        data: { audioUrl, audioDuration },
      });
    } catch (error: any) {
      steps.push({ step: 'audio', success: false, duration: Date.now() - audioStart, error: error.message });
      throw new Error(`Failed to generate audio: ${error.message}`);
    }

    // Step 5: Generate captions (streaming)
    reportProgress('captions', 40, 'Generating captions...');
    const captionsStart = Date.now();
    let captionsUrl: string;
    try {
      const captionsRes = await callStreamingAPI('/generate-captions', {
        audioUrl,
        projectId,
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('captions', 40 + Math.round(data.progress * 0.05), `Generating captions... ${data.progress}%`);
        }
      });
      captionsUrl = captionsRes.captionsUrl;
      steps.push({
        step: 'captions',
        success: true,
        duration: Date.now() - captionsStart,
        data: { captionsUrl },
      });
    } catch (error: any) {
      steps.push({ step: 'captions', success: false, duration: Date.now() - captionsStart, error: error.message });
      throw new Error(`Failed to generate captions: ${error.message}`);
    }

    // Download SRT content once to reuse for clip prompts and image prompts
    let srtContent: string = '';
    try {
      const srtResponse = await fetch(captionsUrl);
      if (srtResponse.ok) {
        srtContent = await srtResponse.text();
        console.log(`[Pipeline] Downloaded SRT: ${srtContent.length} chars`);
      }
    } catch (e) {
      console.warn('[Pipeline] Could not download SRT, continuing...');
    }

    // Step 6: Generate clip prompts (5 × 12s intro videos)
    reportProgress('clipPrompts', 45, 'Generating video clip prompts...');
    const clipPromptsStart = Date.now();
    let clipPrompts: any[];
    try {
      const clipPromptsRes = await callStreamingAPI('/generate-clip-prompts', {
        script,
        srtContent,
        projectId,
        clipCount: INTRO_CLIP_COUNT,
        clipDuration: INTRO_CLIP_DURATION,
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('clipPrompts', 45 + Math.round(data.progress * 0.02), `Generating clip prompts...`);
        }
      });
      clipPrompts = clipPromptsRes.prompts;
      steps.push({
        step: 'clipPrompts',
        success: true,
        duration: Date.now() - clipPromptsStart,
        data: { count: clipPrompts.length },
      });
    } catch (error: any) {
      // Clip prompts failure is non-fatal - continue without intro clips
      console.warn(`[Pipeline] Clip prompts failed, continuing without intro clips: ${error.message}`);
      clipPrompts = [];
      steps.push({ step: 'clipPrompts', success: false, duration: Date.now() - clipPromptsStart, error: error.message });
    }

    // Step 7: Generate video clips (Seedance 1.5 Pro)
    reportProgress('videoClips', 47, 'Generating intro video clips...');
    const videoClipsStart = Date.now();
    let introClips: { url: string; startSeconds: number; endSeconds: number }[] = [];
    if (clipPrompts.length > 0) {
      try {
        const clipsRes = await callStreamingAPI('/generate-video-clips', {
          projectId,
          clips: clipPrompts.map((p: any, i: number) => ({
            index: i + 1,
            startSeconds: i * INTRO_CLIP_DURATION,
            endSeconds: (i + 1) * INTRO_CLIP_DURATION,
            prompt: p.prompt || p,
          })),
          duration: INTRO_CLIP_DURATION,
          stream: true,
        }, (data) => {
          if (data.type === 'progress') {
            reportProgress('videoClips', 47 + Math.round((data.completed / data.total) * 8), `Generating clips ${data.completed}/${data.total}...`);
          }
        }, 1800000);  // 30 min timeout for 12 clips

        introClips = (clipsRes.clips || []).map((c: any) => ({
          url: c.videoUrl,
          startSeconds: (c.index - 1) * INTRO_CLIP_DURATION,
          endSeconds: c.index * INTRO_CLIP_DURATION,
        }));
        steps.push({
          step: 'videoClips',
          success: true,
          duration: Date.now() - videoClipsStart,
          data: { count: introClips.length, totalDuration: introClips.length * INTRO_CLIP_DURATION },
        });
      } catch (error: any) {
        // Video clips failure is non-fatal - continue without intro clips
        console.warn(`[Pipeline] Video clips failed, continuing without intro clips: ${error.message}`);
        introClips = [];
        steps.push({ step: 'videoClips', success: false, duration: Date.now() - videoClipsStart, error: error.message });
      }
    } else {
      steps.push({
        step: 'videoClips',
        success: false,
        duration: 0,
        error: 'Skipped - no clip prompts',
      });
    }

    // Step 8: Generate image prompts (streaming)
    reportProgress('imagePrompts', 55, 'Generating image prompts...');
    const imagePromptsStart = Date.now();
    let imagePrompts: any[];
    try {
      const promptsRes = await callStreamingAPI('/generate-image-prompts', {
        script,
        srtContent,  // Reuse SRT downloaded earlier
        projectId,
        imageCount: calculatedImageCount,
        masterStylePrompt: DUTCH_GOLDEN_AGE_STYLE,  // Use Dutch Golden Age style for Auto Poster
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('imagePrompts', 55 + Math.round(data.progress * 0.03), `Generating image prompts...`);
        }
      });
      imagePrompts = promptsRes.prompts;
      steps.push({
        step: 'imagePrompts',
        success: true,
        duration: Date.now() - imagePromptsStart,
        data: { count: imagePrompts.length },
      });
    } catch (error: any) {
      steps.push({ step: 'imagePrompts', success: false, duration: Date.now() - imagePromptsStart, error: error.message });
      throw new Error(`Failed to generate image prompts: ${error.message}`);
    }

    // Step 9: Generate images (streaming)
    reportProgress('images', 58, 'Generating images...');
    const imagesStart = Date.now();
    let imageUrls: string[];
    try {
      const imagesRes = await callStreamingAPI('/generate-images', {
        prompts: imagePrompts,
        projectId,
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('images', 58 + Math.round((data.completed / data.total) * 10), `Generating images ${data.completed}/${data.total}...`);
        }
      }, 600000);
      // imagesRes.images is already an array of URL strings, not objects
      imageUrls = imagesRes.images as string[];
      steps.push({
        step: 'images',
        success: true,
        duration: Date.now() - imagesStart,
        data: { count: imageUrls.length },
      });
    } catch (error: any) {
      steps.push({ step: 'images', success: false, duration: Date.now() - imagesStart, error: error.message });
      throw new Error(`Failed to generate images: ${error.message}`);
    }

    // Step 10: Analyze thumbnail + generate using original as reference
    reportProgress('thumbnail', 68, 'Analyzing and generating thumbnail...');
    const thumbnailStart = Date.now();
    let thumbnailUrl: string;
    try {
      // Download original thumbnail as base64 for image-to-image generation
      console.log(`[Pipeline] Downloading original thumbnail: ${input.originalThumbnailUrl}`);
      const originalThumbnailBase64 = await downloadImageAsBase64(input.originalThumbnailUrl);

      // Analyze original thumbnail style
      const analysisRes = await callInternalAPI('/analyze-thumbnail', {
        thumbnailUrl: input.originalThumbnailUrl,
        videoTitle: input.originalTitle,
      });

      // Build a prompt for original recreation inspired by the source
      const enhancedPrompt = `Create an original thumbnail inspired by this image. Use the same style, color palette, text placement, and mood - but make it a unique, original composition. Keep similar visual elements and aesthetic but don't copy directly.`;

      // Generate new thumbnail using original as reference image (image-to-image)
      const thumbnailRes = await callStreamingAPI('/generate-thumbnails', {
        projectId,
        exampleImageBase64: originalThumbnailBase64,
        prompt: enhancedPrompt,
        thumbnailCount: 1,
        stream: true,
      }, undefined, 120000);

      thumbnailUrl = thumbnailRes.thumbnails?.[0] || imageUrls[0];
      steps.push({
        step: 'thumbnail',
        success: true,
        duration: Date.now() - thumbnailStart,
        data: { thumbnailUrl },
      });
    } catch (error: any) {
      // Non-fatal: use first image as fallback
      console.warn(`[Pipeline] Thumbnail generation failed, using fallback: ${error.message}`);
      thumbnailUrl = imageUrls[0];
      steps.push({
        step: 'thumbnail',
        success: false,
        duration: Date.now() - thumbnailStart,
        error: error.message,
        data: { thumbnailUrl, fallback: true },
      });
    }

    // Step 11: Render video (streaming) - with intro clips if available
    reportProgress('render', 72, 'Rendering video...');
    const renderStart = Date.now();
    let videoUrl: string;

    // Build image timings from the prompts (each prompt has startSeconds/endSeconds)
    const imageTimings = imagePrompts.map((p: any) => ({
      startSeconds: p.startSeconds,
      endSeconds: p.endSeconds,
    }));

    try {
      // Start render job (returns immediately with job ID)
      const startRes = await callInternalAPI('/render-video', {
        projectId,
        audioUrl,
        imageUrls,
        imageTimings,
        srtContent,
        effects: { smoke_embers: true },
        introClips: introClips.length > 0 ? introClips : undefined,
      });

      const jobId = startRes.jobId;
      console.log(`[Pipeline] Render job started: ${jobId}`);

      // Poll for completion (render-video uses polling, not SSE)
      const POLL_INTERVAL = 3000;  // 3 seconds
      const MAX_POLL_TIME = 60 * 60 * 1000;  // 1 hour
      const pollStart = Date.now();
      let lastProgress = 0;

      while (Date.now() - pollStart < MAX_POLL_TIME) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const statusRes = await fetch(`${API_BASE_URL}/render-video/status/${jobId}`);
        if (!statusRes.ok) {
          console.warn(`[Pipeline] Render status poll failed: ${statusRes.status}`);
          continue;
        }

        const job = await statusRes.json() as { status: string; progress: number; message: string; video_url?: string; error?: string };

        // Update progress if changed
        if (job.progress !== lastProgress) {
          lastProgress = job.progress;
          reportProgress('render', 72 + Math.round(job.progress * 0.18), `Rendering video... ${job.progress}%`);
        }

        if (job.status === 'complete') {
          videoUrl = job.video_url!;
          console.log(`[Pipeline] Render complete: ${videoUrl}`);
          break;
        } else if (job.status === 'failed') {
          throw new Error(job.error || 'Render job failed');
        }
        // Continue polling for queued, rendering, muxing, uploading statuses
      }

      if (!videoUrl) {
        throw new Error('Render job timed out after 1 hour');
      }
      steps.push({
        step: 'render',
        success: true,
        duration: Date.now() - renderStart,
        data: { videoUrl },
      });
    } catch (error: any) {
      steps.push({ step: 'render', success: false, duration: Date.now() - renderStart, error: error.message });
      throw new Error(`Failed to render video: ${error.message}`);
    }

    // Step 12: Upload to YouTube (streaming)
    reportProgress('upload', 90, 'Uploading to YouTube...');
    const uploadStart = Date.now();
    let youtubeVideoId: string;
    let youtubeUrl: string;
    try {
      const uploadRes = await callStreamingAPI('/youtube-upload', {
        videoUrl,
        title: clonedTitle,
        description: `${clonedTitle}\n\nGenerated with AI`,
        tags: ['history', 'documentary', 'education'],
        categoryId: '27',  // Education
        privacyStatus: input.publishAt ? 'private' : 'unlisted',
        publishAt: input.publishAt,
        thumbnailUrl,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('upload', 90 + Math.round(data.progress * 0.1), `Uploading... ${data.progress}%`);
        }
      }, 1200000);  // 20 min timeout
      youtubeVideoId = uploadRes.videoId;
      youtubeUrl = uploadRes.youtubeUrl;
      steps.push({
        step: 'upload',
        success: true,
        duration: Date.now() - uploadStart,
        data: { youtubeVideoId, youtubeUrl, publishAt: input.publishAt },
      });
    } catch (error: any) {
      steps.push({ step: 'upload', success: false, duration: Date.now() - uploadStart, error: error.message });
      throw new Error(`Failed to upload to YouTube: ${error.message}`);
    }

    reportProgress('complete', 100, 'Pipeline complete!');

    return {
      success: true,
      projectId,
      clonedTitle,
      youtubeVideoId,
      youtubeUrl,
      steps,
    };

  } catch (error: any) {
    console.error(`[Pipeline] Failed: ${error.message}`);
    return {
      success: false,
      projectId,
      error: error.message,
      steps,
    };
  }
}

/**
 * Calculate the next 5 PM PST publish time
 */
export function getNext5pmPST(): string {
  const now = new Date();

  // Convert to PST (UTC-8)
  const pstOffset = -8 * 60;  // minutes
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pstNow = new Date(utcNow + (pstOffset * 60000));

  // Set to 5 PM PST today
  const target = new Date(pstNow);
  target.setHours(17, 0, 0, 0);

  // If already past 5 PM PST today, schedule for tomorrow
  if (pstNow >= target) {
    target.setDate(target.getDate() + 1);
  }

  // Convert back to UTC for API
  const utcTarget = new Date(target.getTime() - (pstOffset * 60000));

  return utcTarget.toISOString();
}
