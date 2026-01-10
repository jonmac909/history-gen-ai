import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const router = Router();

// RunPod LTX-2 endpoint configuration
const RUNPOD_LTX_ENDPOINT_ID = process.env.RUNPOD_LTX_ENDPOINT_ID;
const RUNPOD_API_URL = RUNPOD_LTX_ENDPOINT_ID ? `https://api.runpod.ai/v2/${RUNPOD_LTX_ENDPOINT_ID}` : null;

// Constants for video clip generation
const CLIP_DURATION = 10;  // 10 seconds per clip
const CLIP_WIDTH = 768;    // LTX-2 optimal width
const CLIP_HEIGHT = 512;   // LTX-2 optimal height
const CLIP_FPS = 24;       // Frames per second
// Max concurrent clips - set via env var, default 10 for A40/A6000 workers
const MAX_CONCURRENT_CLIPS = parseInt(process.env.LTX_MAX_CONCURRENT_CLIPS || '10', 10);

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
}

interface ClipStatus {
  jobId: string;
  index: number;
  state: 'pending' | 'success' | 'fail';
  videoUrl?: string;
  error?: string;
  filename?: string;
}

// Start a RunPod job for LTX-2 video generation
async function startVideoJob(
  apiKey: string,
  prompt: string,
  projectId: string,
  clipIndex: number
): Promise<string> {
  console.log(`Starting LTX-2 job for clip ${clipIndex + 1}: ${prompt.substring(0, 50)}...`);

  const response = await fetch(`${RUNPOD_API_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        project_id: projectId,
        clip_index: clipIndex,
        duration: CLIP_DURATION,
        width: CLIP_WIDTH,
        height: CLIP_HEIGHT,
        fps: CLIP_FPS,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('RunPod LTX-2 job creation error:', response.status, errorText);
    throw new Error(`Failed to start video job: ${response.status}`);
  }

  const data = await response.json() as any;

  if (!data.id) {
    throw new Error('RunPod job creation failed: no job ID returned');
  }

  console.log(`LTX-2 job created: ${data.id}`);
  return data.id;
}

// Check RunPod job status
async function checkJobStatus(
  apiKey: string,
  jobId: string
): Promise<{ state: string; videoUrl?: string; error?: string; generationTime?: number }> {
  try {
    const response = await fetch(`${RUNPOD_API_URL}/status/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`RunPod status check failed: ${response.status}`);
      return { state: 'pending' };
    }

    const data = await response.json() as any;

    if (data.status === 'COMPLETED' && data.output) {
      if (data.output.error) {
        console.error(`Job ${jobId} completed with error:`, data.output.error);
        return { state: 'fail', error: data.output.error };
      }

      // LTX-2 handler uploads directly to Supabase and returns URL
      const videoUrl = data.output.video_url;
      if (!videoUrl) {
        console.error(`Job ${jobId} completed but no video_url in output`);
        return { state: 'fail', error: 'No video URL returned' };
      }

      console.log(`Job ${jobId} completed: ${videoUrl}`);
      return {
        state: 'success',
        videoUrl,
        generationTime: data.output.generation_time
      };
    } else if (data.status === 'FAILED') {
      const errorMsg = data.error || data.output?.error || 'Job failed';
      console.error(`Job ${jobId} failed:`, errorMsg);
      return { state: 'fail', error: errorMsg };
    } else if (data.status === 'CANCELLED' || data.status === 'TIMED_OUT') {
      console.error(`Job ${jobId} ${data.status.toLowerCase()}`);
      return { state: 'fail', error: `Job ${data.status.toLowerCase()}` };
    }

    return { state: 'pending' };
  } catch (err) {
    console.error(`Error checking job ${jobId}:`, err);
    return { state: 'pending' };
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const runpodApiKey = process.env.RUNPOD_API_KEY;
    if (!runpodApiKey) {
      return res.status(500).json({ error: 'RUNPOD_API_KEY not configured' });
    }

    if (!RUNPOD_LTX_ENDPOINT_ID || !RUNPOD_API_URL) {
      return res.status(500).json({ error: 'RUNPOD_LTX_ENDPOINT_ID not configured' });
    }

    const { projectId, clips, stream = true }: GenerateVideoClipsRequest = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    if (!clips || clips.length === 0) {
      return res.status(400).json({ error: 'No clips provided' });
    }

    const total = clips.length;
    console.log(`\n=== Generating ${total} video clips with LTX-2 ===`);

    if (stream) {
      return handleStreamingClips(req, res, projectId, clips, total, runpodApiKey);
    } else {
      return handleNonStreamingClips(req, res, projectId, clips, runpodApiKey);
    }

  } catch (error) {
    console.error('Error in generate-video-clips:', error);
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
  runpodApiKey: string
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

  const POLL_INTERVAL = 5000; // 5 seconds (video generation takes longer)
  const MAX_POLLING_TIME = 20 * 60 * 1000; // 20 minutes total
  const MAX_RETRIES = 1; // Retry failed jobs once

  try {
    sendEvent({
      type: 'progress',
      completed: 0,
      total,
      message: `Starting video clip generation (${MAX_CONCURRENT_CLIPS} concurrent)...`
    });

    const allResults: ClipStatus[] = [];
    let nextClipIndex = 0;
    const activeJobs = new Map<string, { index: number; startTime: number; retryCount: number; clip: ClipPrompt }>();
    const startTime = Date.now();
    const retryQueue: { clip: ClipPrompt; retryCount: number }[] = [];

    // Helper to start next job
    const startNextJob = async (): Promise<void> => {
      let jobData: { clip: ClipPrompt; retryCount: number } | null = null;

      // First try retry queue, then main queue
      if (retryQueue.length > 0) {
        jobData = retryQueue.shift()!;
        console.log(`Retrying clip ${jobData.clip.index} (attempt ${jobData.retryCount + 1})`);
      } else if (nextClipIndex < clips.length) {
        jobData = { clip: clips[nextClipIndex], retryCount: 0 };
        nextClipIndex++;
      }

      if (!jobData) return;

      try {
        const jobId = await startVideoJob(
          runpodApiKey,
          jobData.clip.prompt,
          projectId,
          jobData.clip.index - 1  // Convert to 0-indexed for filename
        );
        activeJobs.set(jobId, {
          index: jobData.clip.index,
          startTime: Date.now(),
          retryCount: jobData.retryCount,
          clip: jobData.clip
        });
        console.log(`Started clip ${jobData.clip.index}/${total} (${activeJobs.size} active)`);
      } catch (err) {
        console.error(`Failed to create job for clip ${jobData.clip.index}:`, err);
        if (jobData.retryCount < MAX_RETRIES) {
          retryQueue.push({ clip: jobData.clip, retryCount: jobData.retryCount + 1 });
        } else {
          allResults.push({
            jobId: '',
            index: jobData.clip.index,
            state: 'fail',
            error: err instanceof Error ? err.message : 'Failed to create job after retries',
            filename: `clip_${String(jobData.clip.index - 1).padStart(3, '0')}.mp4`
          });
        }
      }
    };

    // Fill initial window with jobs
    const initialBatch = Math.min(MAX_CONCURRENT_CLIPS, clips.length);
    console.log(`Starting initial batch of ${initialBatch} clips...`);
    await Promise.all(Array.from({ length: initialBatch }, () => startNextJob()));

    // Poll active jobs and start new ones as they complete
    while ((activeJobs.size > 0 || retryQueue.length > 0) && Date.now() - startTime < MAX_POLLING_TIME) {
      const jobIds = Array.from(activeJobs.keys());

      // Check all active jobs in parallel
      const checkResults = await Promise.all(
        jobIds.map(async (jobId) => {
          const jobData = activeJobs.get(jobId)!;
          const status = await checkJobStatus(runpodApiKey, jobId);
          return { jobId, jobData, status };
        })
      );

      // Process completed jobs
      for (const { jobId, jobData, status } of checkResults) {
        if (status.state === 'success') {
          const duration = ((Date.now() - jobData.startTime) / 1000).toFixed(1);
          console.log(`✓ Clip ${jobData.index}/${total} completed in ${duration}s`);

          allResults.push({
            jobId,
            index: jobData.index,
            state: 'success',
            videoUrl: status.videoUrl,
            filename: `clip_${String(jobData.index - 1).padStart(3, '0')}.mp4`
          });

          activeJobs.delete(jobId);

          // Start next job in the queue
          await startNextJob();

          // Send progress update
          const completed = allResults.filter(r => r.state === 'success').length;
          sendEvent({
            type: 'progress',
            completed,
            total,
            message: `${completed}/${total} clips generated`,
            latestClip: {
              index: jobData.index,
              videoUrl: status.videoUrl,
              generationTime: status.generationTime
            }
          });

        } else if (status.state === 'fail') {
          console.error(`✗ Clip ${jobData.index}/${total} failed (attempt ${jobData.retryCount + 1}): ${status.error}`);

          activeJobs.delete(jobId);

          // Retry if not exceeded max retries
          if (jobData.retryCount < MAX_RETRIES) {
            retryQueue.push({ clip: jobData.clip, retryCount: jobData.retryCount + 1 });
            console.log(`Queued clip ${jobData.index} for retry`);
          } else {
            allResults.push({
              jobId,
              index: jobData.index,
              state: 'fail',
              error: status.error,
              filename: `clip_${String(jobData.index - 1).padStart(3, '0')}.mp4`
            });
          }

          // Start next job
          await startNextJob();

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
      if (activeJobs.size > 0 || retryQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        // If no active jobs but retries pending, start them
        while (activeJobs.size < MAX_CONCURRENT_CLIPS && retryQueue.length > 0) {
          await startNextJob();
        }
      }
    }

    // Timeout check
    if (activeJobs.size > 0) {
      console.warn(`Timeout: ${activeJobs.size} clips still pending after ${MAX_POLLING_TIME / 1000}s`);
      for (const [jobId, jobData] of activeJobs) {
        allResults.push({
          jobId,
          index: jobData.index,
          state: 'fail',
          error: 'Job timed out',
          filename: `clip_${String(jobData.index - 1).padStart(3, '0')}.mp4`
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

    console.log(`\n=== Video clip generation complete ===`);
    console.log(`Success: ${successfulClips.length}/${total}`);
    console.log(`Failed: ${failedCount}/${total}`);

    sendEvent({
      type: 'complete',
      success: true,
      clips: successfulClips,
      total: successfulClips.length,
      failed: failedCount,
      clipDuration: CLIP_DURATION,
      totalDuration: successfulClips.length * CLIP_DURATION
    });

    cleanup();
    res.end();

  } catch (err) {
    console.error('Stream error:', err);
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
  runpodApiKey: string
) {
  try {
    // Start all jobs
    const jobData = await Promise.all(
      clips.map(async (clip) => {
        const jobId = await startVideoJob(
          runpodApiKey,
          clip.prompt,
          projectId,
          clip.index - 1
        );
        return { jobId, clip };
      })
    );

    // Poll all in parallel
    const maxPollingTime = 20 * 60 * 1000; // 20 minutes
    const pollInterval = 5000;
    const startTime = Date.now();
    const results: { index: number; videoUrl: string | null; error?: string }[] = [];
    const completed: boolean[] = new Array(jobData.length).fill(false);

    while (Date.now() - startTime < maxPollingTime) {
      const pendingIndices = completed.map((c, i) => c ? -1 : i).filter(i => i >= 0);

      if (pendingIndices.length === 0) break;

      const checks = await Promise.all(
        pendingIndices.map(async (i) => {
          const { jobId, clip } = jobData[i];
          const status = await checkJobStatus(runpodApiKey, jobId);
          return { index: i, clip, status };
        })
      );

      for (const { index, clip, status } of checks) {
        if (status.state === 'success' || status.state === 'fail') {
          completed[index] = true;
          results.push({
            index: clip.index,
            videoUrl: status.videoUrl || null,
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

    console.log(`LTX-2 generated ${successfulClips.length}/${clips.length} video clips`);

    return res.json({
      success: true,
      clips: successfulClips,
      total: successfulClips.length,
      failed: results.filter(r => !r.videoUrl).length
    });

  } catch (err) {
    console.error('Non-streaming clip generation error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Clip generation failed'
    });
  }
}

export default router;
