/**
 * Pipeline Runner - Server-side orchestrator for full video generation pipeline
 *
 * Runs the complete pipeline for cloning a video:
 * 1. Fetch transcript from source video
 * 2. Rewrite title
 * 3. Generate script from transcript
 * 4. Generate audio (voice cloning)
 * 5. Generate captions
 * 6. Generate clip prompts (5 × 12s video intro)
 * 7. Generate video clips (Seedance 1.5 Pro)
 * 8. Generate image prompts (for remaining duration)
 * 9. Generate images
 * 10. Analyze + generate thumbnail
 * 11. Render video (clips + images)
 * 12. Upload to YouTube
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

// Base URL for internal API calls
const API_BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 10000}`;

export interface PipelineInput {
  sourceVideoId: string;
  sourceVideoUrl: string;
  originalTitle: string;
  originalThumbnailUrl: string;
  channelName?: string;
  publishAt?: string;  // ISO timestamp for scheduled publish (5 PM PST)
  sourceDurationSeconds?: number;  // Original video duration for matching script length
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

// Intro video clips configuration
const INTRO_CLIP_COUNT = 5;  // 5 video clips at start
const INTRO_CLIP_DURATION = 12;  // 12 seconds each (Seedance max)
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

    // Step 2: Rewrite title
    reportProgress('title', 10, 'Rewriting title...');
    const titleStart = Date.now();
    let clonedTitle: string;
    try {
      const titleRes = await callInternalAPI('/rewrite-title', {
        originalTitle: input.originalTitle,
        channelName: input.channelName,
      });
      clonedTitle = titleRes.recommendedTitle;
      steps.push({
        step: 'title',
        success: true,
        duration: Date.now() - titleStart,
        data: { original: input.originalTitle, rewritten: clonedTitle },
      });
    } catch (error: any) {
      steps.push({ step: 'title', success: false, duration: Date.now() - titleStart, error: error.message });
      throw new Error(`Failed to rewrite title: ${error.message}`);
    }

    // Step 3: Generate script (streaming)
    reportProgress('script', 15, 'Generating script...');
    const scriptStart = Date.now();
    let script: string;

    // Calculate target word count based on source video duration
    // 150 words/minute is typical documentary narration pace
    const WORDS_PER_MINUTE = 150;
    const durationMinutes = input.sourceDurationSeconds ? Math.round(input.sourceDurationSeconds / 60) : 20;
    const targetWordCount = durationMinutes * WORDS_PER_MINUTE;
    console.log(`[Pipeline] Target word count: ${targetWordCount} (${durationMinutes} min @ ${WORDS_PER_MINUTE} wpm)`);

    try {
      const scriptRes = await callStreamingAPI('/rewrite-script', {
        transcript,
        projectId,
        voiceStyle: '(sincere) (soft tone)',
        wordCount: targetWordCount,
        stream: true,  // Required for SSE mode
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('script', 15 + Math.round(data.progress * 0.1), `Generating script... ${data.progress}%`);
        }
      }, 1800000);  // 30 min timeout for very long scripts (200+ min videos)
      script = scriptRes.script;
      steps.push({
        step: 'script',
        success: true,
        duration: Date.now() - scriptStart,
        data: { wordCount: script.split(/\s+/).length },
      });
    } catch (error: any) {
      steps.push({ step: 'script', success: false, duration: Date.now() - scriptStart, error: error.message });
      throw new Error(`Failed to generate script: ${error.message}`);
    }

    // Step 4: Generate audio (streaming)
    reportProgress('audio', 25, 'Generating audio...');
    const audioStart = Date.now();
    let audioUrl: string;
    let audioDuration: number;
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

    // Step 6: Generate clip prompts (5 × 12s intro videos)
    reportProgress('clipPrompts', 45, 'Generating video clip prompts...');
    const clipPromptsStart = Date.now();
    let clipPrompts: any[];
    try {
      const clipPromptsRes = await callStreamingAPI('/generate-clip-prompts', {
        script,
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
        }, 900000);  // 15 min timeout for 5 clips

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
        captionsUrl,
        projectId,
        imageCount: 10,
        masterStylePrompt: 'Photorealistic historical scene, dramatic cinematic lighting, 8K quality',
        stream: true,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('imagePrompts', 55 + Math.round(data.progress * 0.03), `Generating prompts...`);
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
      imageUrls = imagesRes.images.map((img: any) => img.imageUrl);
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

    // Step 10: Analyze thumbnail + generate
    reportProgress('thumbnail', 68, 'Analyzing and generating thumbnail...');
    const thumbnailStart = Date.now();
    let thumbnailUrl: string;
    try {
      // Analyze original thumbnail
      const analysisRes = await callInternalAPI('/analyze-thumbnail', {
        thumbnailUrl: input.originalThumbnailUrl,
        videoTitle: input.originalTitle,
      });

      // Generate new thumbnail based on analysis
      const thumbnailRes = await callStreamingAPI('/generate-thumbnails', {
        projectId,
        title: clonedTitle,
        stylePrompt: analysisRes.analysis?.recreationPrompt || 'Dramatic YouTube thumbnail, bold text, high contrast',
        count: 1,
        stream: true,
      }, undefined, 120000);

      thumbnailUrl = thumbnailRes.thumbnails?.[0]?.url || imageUrls[0];
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
    try {
      const renderRes = await callStreamingAPI('/render-video', {
        projectId,
        audioUrl,
        captionsUrl,
        imageUrls,
        effectType: 'smoke_embers',
        introClips: introClips.length > 0 ? introClips : undefined,
      }, (data) => {
        if (data.type === 'progress') {
          reportProgress('render', 72 + Math.round(data.progress * 0.18), `Rendering video... ${data.progress}%`);
        }
      }, 1800000);  // 30 min timeout
      videoUrl = renderRes.videoUrl;
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
