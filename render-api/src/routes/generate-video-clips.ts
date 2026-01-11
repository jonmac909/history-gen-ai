import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const router = Router();

// Kie.ai Seedance API configuration
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const KIE_MODEL = 'bytedance/seedance-1.5-pro';

// Constants for video clip generation (Seedance 1.5 Pro)
const CLIP_DURATION = 12;  // 12 seconds per clip (Seedance max)
const CLIP_RESOLUTION = '720p';
const CLIP_ASPECT_RATIO = '16:9';
// Max concurrent clips - Kie.ai handles queueing, but limit for cost control
const MAX_CONCURRENT_CLIPS = parseInt(process.env.SEEDANCE_MAX_CONCURRENT_CLIPS || '5', 10);

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
async function startVideoTask(
  apiKey: string,
  prompt: string,
  clipIndex: number,
  duration: number = CLIP_DURATION,
  resolution: string = CLIP_RESOLUTION
): Promise<string> {
  console.log(`[Seedance] Starting task for clip ${clipIndex + 1}: ${prompt.substring(0, 50)}...`);

  const response = await fetch(`${KIE_API_URL}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt,
        aspect_ratio: CLIP_ASPECT_RATIO,
        resolution,
        duration: String(duration),
        generate_audio: false,  // We use our own TTS
        fixed_lens: false,  // Allow dynamic camera movement
      },
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

// Copy video from Kie.ai URL to our Supabase storage
async function copyToSupabase(
  videoUrl: string,
  projectId: string,
  clipIndex: number
): Promise<string> {
  try {
    const supabase = getSupabaseClient();

    // Download video from Kie.ai
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    const videoBuffer = await response.buffer();
    const filename = `clip_${String(clipIndex).padStart(3, '0')}.mp4`;
    const storagePath = `${projectId}/clips/${filename}`;

    // Upload to Supabase
    const { error } = await supabase.storage
      .from('generated-assets')
      .upload(storagePath, videoBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (error) {
      console.error(`[Seedance] Failed to upload to Supabase:`, error);
      // Return original URL if upload fails
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

    // Validate duration (Seedance supports 4, 8, or 12 seconds)
    const validDuration = [4, 8, 12].includes(duration) ? duration : CLIP_DURATION;

    const total = clips.length;
    console.log(`\n=== Generating ${total} video clips with Seedance 1.5 Pro ===`);
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

export default router;
