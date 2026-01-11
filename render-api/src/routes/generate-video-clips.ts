import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execAsync = promisify(exec);

// Use static binaries for ffmpeg/ffprobe
const FFMPEG_PATH = ffmpegStatic || 'ffmpeg';
const FFPROBE_PATH = ffprobeStatic.path || 'ffprobe';
const router = Router();

// Kie.ai API configuration
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
// Model for text-to-video (first clip only)
const KIE_MODEL_T2V = 'bytedance/seedance-1.5-pro';
// Model for image-to-video (clips 2+ with frame continuity) - 3x faster
const KIE_MODEL_I2V = 'bytedance/v1-pro-fast-image-to-video';

// Constants for video clip generation
// 15 clips × 4s = 60 seconds total intro (all using 1.5 Pro T2V)
const CLIP_DURATION = 4;  // 4 seconds per clip (1.5 Pro supports 4/8/12)
const CLIP_COUNT = 15;    // 15 clips for 60 second intro
const CLIP_RESOLUTION = '720p';
const CLIP_ASPECT_RATIO = '16:9';  // Used for 1.5 Pro only
// Max concurrent clips - submit all at once, Kie.ai handles queueing
const MAX_CONCURRENT_CLIPS = parseInt(process.env.SEEDANCE_MAX_CONCURRENT_CLIPS || '15', 10);
// Disable frame continuity - use parallel generation for speed
// Clips will have fade in/out transitions instead
const ENABLE_FRAME_CONTINUITY = false;
// Fade duration in seconds for smooth transitions between clips
const FADE_DURATION = 0.5;

interface ClipPrompt {
  index: number;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  sceneDescription?: string;
}

interface GenerateVideoClipsRequest {
  projectId: string;
  clips: ClipPrompt[];
  stream?: boolean;
  duration?: number;  // 4, 8, or 12 seconds
  resolution?: string;  // 480p or 720p
}

interface ClipStatus {
  taskId: string;
  index: number;
  state: 'pending' | 'success' | 'fail';
  videoUrl?: string;
  error?: string;
  filename?: string;
}

// Supabase client for copying videos to our storage
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key);
}

// Start a Kie.ai Seedance task
// Uses 1.5 Pro (T2V) for first clip, v1-pro-fast (I2V) for clips 2+ with start frame
async function startVideoTask(
  apiKey: string,
  prompt: string,
  clipIndex: number,
  duration: number = CLIP_DURATION,
  resolution: string = CLIP_RESOLUTION,
  startFrameUrl?: string  // Optional start frame for seamless continuity
): Promise<string> {
  const hasStartFrame = !!startFrameUrl;
  const model = hasStartFrame ? KIE_MODEL_I2V : KIE_MODEL_T2V;
  console.log(`[Seedance] Starting task for clip ${clipIndex + 1} using ${model}: ${prompt.substring(0, 50)}...${hasStartFrame ? ' (with start frame)' : ''}`);

  let input: any;

  if (hasStartFrame) {
    // v1-pro-fast-image-to-video: requires image_url (singular), supports 5s/10s
    input = {
      prompt,
      image_url: startFrameUrl,  // v1-pro-fast uses image_url (singular), not input_urls
      resolution,
      duration: String(duration),
    };
    console.log(`[Seedance] Using I2V with start frame: ${startFrameUrl.substring(0, 80)}...`);
  } else {
    // seedance-1.5-pro: text-to-video for first clip, supports 4/8/12s
    // Use 4s for short clips (5s target), 8s for medium, 12s for long
    const t2vDuration = duration <= 5 ? 4 : duration <= 10 ? 8 : 12;
    input = {
      prompt,
      aspect_ratio: CLIP_ASPECT_RATIO,
      resolution,
      duration: String(t2vDuration),
      generate_audio: false,  // We use our own TTS
      fixed_lens: false,  // Allow dynamic camera movement
    };
    console.log(`[Seedance] Using T2V for first clip (${t2vDuration}s duration)`);
  }

  const response = await fetch(`${KIE_API_URL}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Seedance] Task creation error:', response.status, errorText);
    throw new Error(`Failed to start video task: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  if (data.code !== 200 || !data.data?.taskId) {
    console.error('[Seedance] Task creation failed:', data);
    throw new Error(data.message || 'Task creation failed: no taskId returned');
  }

  console.log(`[Seedance] Task created: ${data.data.taskId}`);
  return data.data.taskId;
}

// Check Kie.ai task status
async function checkTaskStatus(
  apiKey: string,
  taskId: string
): Promise<{ state: string; videoUrl?: string; error?: string; costTime?: number }> {
  try {
    const response = await fetch(`${KIE_API_URL}/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`[Seedance] Status check failed: ${response.status}`);
      return { state: 'pending' };
    }

    const data = await response.json() as any;

    if (data.code !== 200 || !data.data) {
      return { state: 'pending' };
    }

    const task = data.data;

    if (task.state === 'success') {
      // Parse resultJson to get video URL
      let videoUrl: string | undefined;
      try {
        const result = JSON.parse(task.resultJson);
        videoUrl = result.resultUrls?.[0];
      } catch {
        console.error(`[Seedance] Failed to parse resultJson for task ${taskId}`);
      }

      if (!videoUrl) {
        console.error(`[Seedance] Task ${taskId} completed but no video URL`);
        return { state: 'fail', error: 'No video URL in result' };
      }

      console.log(`[Seedance] Task ${taskId} completed: ${videoUrl}`);
      return {
        state: 'success',
        videoUrl,
        costTime: task.costTime
      };
    } else if (task.state === 'fail') {
      const errorMsg = task.failMsg || 'Task failed';
      console.error(`[Seedance] Task ${taskId} failed:`, errorMsg);
      return { state: 'fail', error: errorMsg };
    } else if (['waiting', 'queuing', 'generating'].includes(task.state)) {
      return { state: 'pending' };
    }

    return { state: 'pending' };
  } catch (err) {
    console.error(`[Seedance] Error checking task ${taskId}:`, err);
    return { state: 'pending' };
  }
}

// Copy video from Kie.ai URL to our Supabase storage with fade in/out effects
async function copyToSupabase(
  videoUrl: string,
  projectId: string,
  clipIndex: number
): Promise<string> {
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `clip_input_${clipIndex}_${Date.now()}.mp4`);
  const outputPath = path.join(tempDir, `clip_output_${clipIndex}_${Date.now()}.mp4`);

  try {
    const supabase = getSupabaseClient();

    // Download video from Kie.ai
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    const videoBuffer = await response.buffer();
    fs.writeFileSync(inputPath, videoBuffer);

    // Get video duration for fade out timing
    const { stdout: durationOutput } = await execAsync(
      `"${FFPROBE_PATH}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    const duration = parseFloat(durationOutput.trim());

    if (!isNaN(duration) && duration > FADE_DURATION * 2) {
      // Apply fade in at start and fade out at end
      const fadeOutStart = duration - FADE_DURATION;
      console.log(`[Seedance] Applying ${FADE_DURATION}s fade in/out to clip ${clipIndex + 1}`);

      await execAsync(
        `"${FFMPEG_PATH}" -y -i "${inputPath}" -vf "fade=t=in:st=0:d=${FADE_DURATION},fade=t=out:st=${fadeOutStart}:d=${FADE_DURATION}" -c:a copy "${outputPath}"`
      );
    } else {
      // Video too short for fades, just copy
      console.log(`[Seedance] Clip ${clipIndex + 1} too short for fades, skipping`);
      fs.copyFileSync(inputPath, outputPath);
    }

    // Read processed video
    const processedBuffer = fs.readFileSync(outputPath);
    const filename = `clip_${String(clipIndex).padStart(3, '0')}.mp4`;
    const storagePath = `${projectId}/clips/${filename}`;

    // Upload to Supabase
    const { error } = await supabase.storage
      .from('generated-assets')
      .upload(storagePath, processedBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (error) {
      console.error(`[Seedance] Failed to upload to Supabase:`, error);
      return videoUrl;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(storagePath);

    console.log(`[Seedance] Copied to Supabase: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error(`[Seedance] Error copying to Supabase:`, err);
    // Return original URL if copy fails
    return videoUrl;
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Extract the last frame from a video for seamless clip continuity
async function extractLastFrame(
  videoUrl: string,
  projectId: string,
  clipIndex: number
): Promise<string | null> {
  const tempDir = os.tmpdir();
  const videoPath = path.join(tempDir, `clip_${clipIndex}_${Date.now()}.mp4`);
  const framePath = path.join(tempDir, `frame_${clipIndex}_${Date.now()}.jpg`);

  try {
    console.log(`[Seedance] Extracting last frame from clip ${clipIndex + 1}...`);

    // Download video to temp file
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    const videoBuffer = await response.buffer();
    fs.writeFileSync(videoPath, videoBuffer);

    // Get video duration using ffprobe (static binary)
    const { stdout: durationOutput } = await execAsync(
      `"${FFPROBE_PATH}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    const duration = parseFloat(durationOutput.trim());

    if (isNaN(duration) || duration <= 0) {
      throw new Error('Could not determine video duration');
    }

    // Extract the last frame (0.1 seconds before end for safety) using ffmpeg (static binary)
    const frameTime = Math.max(0, duration - 0.1);
    await execAsync(
      `"${FFMPEG_PATH}" -y -ss ${frameTime} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`
    );

    // Verify frame was created
    if (!fs.existsSync(framePath)) {
      throw new Error('Frame extraction failed - no output file');
    }

    // Upload frame to Supabase
    const supabase = getSupabaseClient();
    const frameBuffer = fs.readFileSync(framePath);
    const storagePath = `${projectId}/clips/frames/frame_${String(clipIndex).padStart(3, '0')}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(storagePath, frameBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.error(`[Seedance] Failed to upload frame:`, uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(storagePath);

    console.log(`[Seedance] Extracted last frame: ${urlData.publicUrl}`);
    return urlData.publicUrl;

  } catch (err) {
    console.error(`[Seedance] Error extracting last frame:`, err);
    return null;
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return res.status(500).json({ error: 'KIE_API_KEY not configured' });
    }

    const {
      projectId,
      clips,
      stream = true,
      duration = CLIP_DURATION,
      resolution = CLIP_RESOLUTION
    }: GenerateVideoClipsRequest = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    if (!clips || clips.length === 0) {
      return res.status(400).json({ error: 'No clips provided' });
    }

    // Validate duration (v1-pro-fast supports 5 or 10 seconds, 1.5 Pro adjusts internally)
    const validDuration = [5, 10].includes(duration) ? duration : CLIP_DURATION;

    const total = clips.length;
    console.log(`\n=== Generating ${total} video clips (1.5 Pro T2V + v1-pro-fast I2V) ===`);
    console.log(`Duration: ${validDuration}s, Resolution: ${resolution}`);

    if (stream) {
      return handleStreamingClips(req, res, projectId, clips, total, kieApiKey, validDuration, resolution);
    } else {
      return handleNonStreamingClips(req, res, projectId, clips, kieApiKey, validDuration, resolution);
    }

  } catch (error) {
    console.error('[Seedance] Error in generate-video-clips:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Handle streaming video clip generation with rolling concurrency
async function handleStreamingClips(
  req: Request,
  res: Response,
  projectId: string,
  clips: ClipPrompt[],
  total: number,
  kieApiKey: string,
  duration: number,
  resolution: string
) {
  // Use sequential mode with frame continuity for seamless clip flow
  if (ENABLE_FRAME_CONTINUITY) {
    return handleSequentialClipsWithContinuity(req, res, projectId, clips, total, kieApiKey, duration, resolution);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Keepalive heartbeat
  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeatInterval);
  };

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const POLL_INTERVAL = 3000; // 3 seconds (Seedance is fast)
  const MAX_POLLING_TIME = 10 * 60 * 1000; // 10 minutes total
  const MAX_RETRIES = 1;

  try {
    sendEvent({
      type: 'progress',
      completed: 0,
      total,
      message: `Starting video clip generation with Seedance 1.5 Pro...`
    });

    const allResults: ClipStatus[] = [];
    let nextClipIndex = 0;
    const activeTasks = new Map<string, { index: number; startTime: number; retryCount: number; clip: ClipPrompt }>();
    const startTime = Date.now();
    const retryQueue: { clip: ClipPrompt; retryCount: number }[] = [];

    // Helper to start next task
    const startNextTask = async (): Promise<void> => {
      let taskData: { clip: ClipPrompt; retryCount: number } | null = null;

      // First try retry queue, then main queue
      if (retryQueue.length > 0) {
        taskData = retryQueue.shift()!;
        console.log(`[Seedance] Retrying clip ${taskData.clip.index} (attempt ${taskData.retryCount + 1})`);
      } else if (nextClipIndex < clips.length) {
        taskData = { clip: clips[nextClipIndex], retryCount: 0 };
        nextClipIndex++;
      }

      if (!taskData) return;

      try {
        const taskId = await startVideoTask(
          kieApiKey,
          taskData.clip.prompt,
          taskData.clip.index - 1,  // Convert to 0-indexed for filename
          duration,
          resolution
        );
        activeTasks.set(taskId, {
          index: taskData.clip.index,
          startTime: Date.now(),
          retryCount: taskData.retryCount,
          clip: taskData.clip
        });
        console.log(`[Seedance] Started clip ${taskData.clip.index}/${total} (${activeTasks.size} active)`);
      } catch (err) {
        console.error(`[Seedance] Failed to create task for clip ${taskData.clip.index}:`, err);
        if (taskData.retryCount < MAX_RETRIES) {
          retryQueue.push({ clip: taskData.clip, retryCount: taskData.retryCount + 1 });
        } else {
          allResults.push({
            taskId: '',
            index: taskData.clip.index,
            state: 'fail',
            error: err instanceof Error ? err.message : 'Failed to create task after retries',
            filename: `clip_${String(taskData.clip.index - 1).padStart(3, '0')}.mp4`
          });
        }
      }
    };

    // Fill initial window with tasks
    const initialBatch = Math.min(MAX_CONCURRENT_CLIPS, clips.length);
    console.log(`[Seedance] Starting initial batch of ${initialBatch} clips...`);
    await Promise.all(Array.from({ length: initialBatch }, () => startNextTask()));

    // Poll active tasks and start new ones as they complete
    while ((activeTasks.size > 0 || retryQueue.length > 0) && Date.now() - startTime < MAX_POLLING_TIME) {
      const taskIds = Array.from(activeTasks.keys());

      // Check all active tasks in parallel
      const checkResults = await Promise.all(
        taskIds.map(async (taskId) => {
          const taskData = activeTasks.get(taskId)!;
          const status = await checkTaskStatus(kieApiKey, taskId);
          return { taskId, taskData, status };
        })
      );

      // Process completed tasks
      for (const { taskId, taskData, status } of checkResults) {
        if (status.state === 'success') {
          const durationSec = ((Date.now() - taskData.startTime) / 1000).toFixed(1);
          console.log(`[Seedance] ✓ Clip ${taskData.index}/${total} completed in ${durationSec}s`);

          // Copy video to our Supabase storage
          const supabaseUrl = await copyToSupabase(
            status.videoUrl!,
            projectId,
            taskData.index - 1
          );

          allResults.push({
            taskId,
            index: taskData.index,
            state: 'success',
            videoUrl: supabaseUrl,
            filename: `clip_${String(taskData.index - 1).padStart(3, '0')}.mp4`
          });

          activeTasks.delete(taskId);

          // Start next task in the queue
          await startNextTask();

          // Send progress update
          const completed = allResults.filter(r => r.state === 'success').length;
          sendEvent({
            type: 'progress',
            completed,
            total,
            message: `${completed}/${total} clips generated`,
            latestClip: {
              index: taskData.index,
              videoUrl: supabaseUrl,
              generationTime: status.costTime
            }
          });

        } else if (status.state === 'fail') {
          console.error(`[Seedance] ✗ Clip ${taskData.index}/${total} failed (attempt ${taskData.retryCount + 1}): ${status.error}`);

          activeTasks.delete(taskId);

          // Retry if not exceeded max retries
          if (taskData.retryCount < MAX_RETRIES) {
            retryQueue.push({ clip: taskData.clip, retryCount: taskData.retryCount + 1 });
            console.log(`[Seedance] Queued clip ${taskData.index} for retry`);
          } else {
            allResults.push({
              taskId,
              index: taskData.index,
              state: 'fail',
              error: status.error,
              filename: `clip_${String(taskData.index - 1).padStart(3, '0')}.mp4`
            });
          }

          // Start next task
          await startNextTask();

          // Send progress update
          const completed = allResults.filter(r => r.state === 'success').length;
          const failed = allResults.filter(r => r.state === 'fail').length;
          sendEvent({
            type: 'progress',
            completed,
            total,
            message: `${completed}/${total} done${failed > 0 ? `, ${failed} failed` : ''}`
          });
        }
      }

      // Wait before next poll
      if (activeTasks.size > 0 || retryQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        // If no active tasks but retries pending, start them
        while (activeTasks.size < MAX_CONCURRENT_CLIPS && retryQueue.length > 0) {
          await startNextTask();
        }
      }
    }

    // Timeout check
    if (activeTasks.size > 0) {
      console.warn(`[Seedance] Timeout: ${activeTasks.size} clips still pending after ${MAX_POLLING_TIME / 1000}s`);
      for (const [taskId, taskData] of activeTasks) {
        allResults.push({
          taskId,
          index: taskData.index,
          state: 'fail',
          error: 'Task timed out',
          filename: `clip_${String(taskData.index - 1).padStart(3, '0')}.mp4`
        });
      }
    }

    // Sort results by original index
    const sortedResults = [...allResults].sort((a, b) => a.index - b.index);
    const successfulClips = sortedResults
      .filter(r => r.state === 'success' && r.videoUrl)
      .map(r => ({
        index: r.index,
        videoUrl: r.videoUrl!,
        filename: r.filename
      }));

    const failedCount = sortedResults.filter(r => r.state === 'fail').length;

    console.log(`\n=== Seedance video clip generation complete ===`);
    console.log(`Success: ${successfulClips.length}/${total}`);
    console.log(`Failed: ${failedCount}/${total}`);

    sendEvent({
      type: 'complete',
      success: true,
      clips: successfulClips,
      total: successfulClips.length,
      failed: failedCount,
      clipDuration: duration,
      totalDuration: successfulClips.length * duration
    });

    cleanup();
    res.end();

  } catch (err) {
    console.error('[Seedance] Stream error:', err);
    sendEvent({
      type: 'error',
      error: err instanceof Error ? err.message : 'Clip generation failed'
    });
    cleanup();
    res.end();
  }
}

// Handle non-streaming video clip generation
async function handleNonStreamingClips(
  req: Request,
  res: Response,
  projectId: string,
  clips: ClipPrompt[],
  kieApiKey: string,
  duration: number,
  resolution: string
) {
  try {
    // Start all tasks
    const taskData = await Promise.all(
      clips.map(async (clip) => {
        const taskId = await startVideoTask(
          kieApiKey,
          clip.prompt,
          clip.index - 1,
          duration,
          resolution
        );
        return { taskId, clip };
      })
    );

    // Poll all in parallel
    const maxPollingTime = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 3000;
    const startTime = Date.now();
    const results: { index: number; videoUrl: string | null; error?: string }[] = [];
    const completed: boolean[] = new Array(taskData.length).fill(false);

    while (Date.now() - startTime < maxPollingTime) {
      const pendingIndices = completed.map((c, i) => c ? -1 : i).filter(i => i >= 0);

      if (pendingIndices.length === 0) break;

      const checks = await Promise.all(
        pendingIndices.map(async (i) => {
          const { taskId, clip } = taskData[i];
          const status = await checkTaskStatus(kieApiKey, taskId);
          return { index: i, clip, taskId, status };
        })
      );

      for (const { index, clip, taskId, status } of checks) {
        if (status.state === 'success' || status.state === 'fail') {
          completed[index] = true;

          let videoUrl = status.videoUrl || null;
          if (videoUrl) {
            // Copy to Supabase
            videoUrl = await copyToSupabase(videoUrl, projectId, clip.index - 1);
          }

          results.push({
            index: clip.index,
            videoUrl,
            error: status.error
          });
        }
      }

      if (pendingIndices.length > 0) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // Sort by index
    results.sort((a, b) => a.index - b.index);

    const successfulClips = results
      .filter(r => r.videoUrl)
      .map(r => ({
        index: r.index,
        videoUrl: r.videoUrl!,
        filename: `clip_${String(r.index - 1).padStart(3, '0')}.mp4`
      }));

    console.log(`[Seedance] Generated ${successfulClips.length}/${clips.length} video clips`);

    return res.json({
      success: true,
      clips: successfulClips,
      total: successfulClips.length,
      failed: results.filter(r => !r.videoUrl).length
    });

  } catch (err) {
    console.error('[Seedance] Non-streaming clip generation error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Clip generation failed'
    });
  }
}

// Handle sequential video clip generation with frame continuity
// Each clip's last frame becomes the next clip's start frame for seamless flow
async function handleSequentialClipsWithContinuity(
  req: Request,
  res: Response,
  projectId: string,
  clips: ClipPrompt[],
  total: number,
  kieApiKey: string,
  duration: number,
  resolution: string
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeatInterval);
  };

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const POLL_INTERVAL = 3000;
  const MAX_POLL_TIME_PER_CLIP = 5 * 60 * 1000; // 5 minutes per clip

  try {
    console.log(`\n=== Sequential clip generation with frame continuity ===`);
    console.log(`Generating ${total} clips sequentially (last frame → next clip's start frame)`);

    sendEvent({
      type: 'progress',
      completed: 0,
      total,
      message: `Starting sequential generation (seamless flow mode)...`
    });

    const successfulClips: { index: number; videoUrl: string; filename: string }[] = [];
    let lastFrameUrl: string | null = null;
    let failedCount = 0;

    // Process clips one at a time, passing last frame to next clip
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const clipIndex = clip.index - 1; // 0-indexed for filename

      sendEvent({
        type: 'progress',
        completed: successfulClips.length,
        total,
        message: `Generating clip ${i + 1}/${total}${lastFrameUrl ? ' (with continuity frame)' : ''}...`
      });

      try {
        // Start task with optional start frame from previous clip
        const taskId = await startVideoTask(
          kieApiKey,
          clip.prompt,
          clipIndex,
          duration,
          resolution,
          lastFrameUrl || undefined  // Pass last frame URL if available
        );

        console.log(`[Seedance] Started clip ${i + 1}/${total}${lastFrameUrl ? ' (with start frame)' : ''}`);

        // Poll until complete
        const pollStart = Date.now();
        let videoUrl: string | null = null;

        while (Date.now() - pollStart < MAX_POLL_TIME_PER_CLIP) {
          const status = await checkTaskStatus(kieApiKey, taskId);

          if (status.state === 'success' && status.videoUrl) {
            videoUrl = status.videoUrl;
            const durationSec = ((Date.now() - pollStart) / 1000).toFixed(1);
            console.log(`[Seedance] ✓ Clip ${i + 1}/${total} completed in ${durationSec}s`);
            break;
          } else if (status.state === 'fail') {
            console.error(`[Seedance] ✗ Clip ${i + 1}/${total} failed: ${status.error}`);
            break;
          }

          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }

        if (videoUrl) {
          // Copy video to Supabase
          const supabaseUrl = await copyToSupabase(videoUrl, projectId, clipIndex);

          successfulClips.push({
            index: clip.index,
            videoUrl: supabaseUrl,
            filename: `clip_${String(clipIndex).padStart(3, '0')}.mp4`
          });

          // Extract last frame for next clip (except for the last clip)
          if (i < clips.length - 1) {
            sendEvent({
              type: 'progress',
              completed: successfulClips.length,
              total,
              message: `Extracting continuity frame from clip ${i + 1}...`
            });

            lastFrameUrl = await extractLastFrame(supabaseUrl, projectId, clipIndex);

            if (lastFrameUrl) {
              console.log(`[Seedance] Extracted continuity frame for clip ${i + 2}`);
            } else {
              console.warn(`[Seedance] Failed to extract frame, next clip will start fresh`);
            }
          }

          sendEvent({
            type: 'progress',
            completed: successfulClips.length,
            total,
            message: `${successfulClips.length}/${total} clips generated`,
            latestClip: {
              index: clip.index,
              videoUrl: supabaseUrl
            }
          });

        } else {
          console.error(`[Seedance] Clip ${i + 1} timed out or failed`);
          failedCount++;
          // Continue to next clip without frame continuity
          lastFrameUrl = null;
        }

      } catch (err) {
        console.error(`[Seedance] Error generating clip ${i + 1}:`, err);
        failedCount++;
        lastFrameUrl = null; // Reset frame continuity on error
      }
    }

    console.log(`\n=== Sequential generation complete ===`);
    console.log(`Success: ${successfulClips.length}/${total}`);
    console.log(`Failed: ${failedCount}/${total}`);

    sendEvent({
      type: 'complete',
      success: true,
      clips: successfulClips,
      total: successfulClips.length,
      failed: failedCount,
      clipDuration: duration,
      totalDuration: successfulClips.length * duration,
      mode: 'sequential_with_continuity'
    });

    cleanup();
    res.end();

  } catch (err) {
    console.error('[Seedance] Sequential generation error:', err);
    sendEvent({
      type: 'error',
      error: err instanceof Error ? err.message : 'Sequential clip generation failed'
    });
    cleanup();
    res.end();
  }
}

export default router;
