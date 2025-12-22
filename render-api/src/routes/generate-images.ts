import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { allocateWorkersForImages } from '../utils/runpod';

const router = Router();

// RunPod Z-Image endpoint configuration
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID;
const RUNPOD_API_URL = RUNPOD_ENDPOINT_ID ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}` : null;

interface ImagePromptWithTiming {
  index: number;
  prompt: string;
  startTime: string;
  endTime: string;
}

interface GenerateImagesRequest {
  prompts: string[] | ImagePromptWithTiming[];
  quality: string;
  aspectRatio?: string;
  stream?: boolean;
  projectId?: string;
}

interface JobStatus {
  jobId: string;
  index: number;
  state: 'pending' | 'success' | 'fail';
  imageUrl?: string;
  error?: string;
  filename?: string;
}

// Start a RunPod job for Z-Image generation
async function startImageJob(apiKey: string, prompt: string, quality: string, aspectRatio: string): Promise<string> {
  console.log(`Starting RunPod job for: ${prompt.substring(0, 50)}...`);

  const response = await fetch(`${RUNPOD_API_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        quality: quality === "high" ? "high" : "basic",
        aspectRatio,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('RunPod job creation error:', response.status, errorText);
    throw new Error(`Failed to start image job: ${response.status}`);
  }

  const data = await response.json() as any;

  if (!data.id) {
    throw new Error('RunPod job creation failed: no job ID returned');
  }

  console.log(`RunPod job created: ${data.id}`);
  return data.id;
}

// Check RunPod job status and upload image if complete
async function checkJobStatus(
  apiKey: string,
  jobId: string,
  supabaseUrl: string,
  supabaseKey: string,
  customFilename?: string,
  projectId?: string
): Promise<{ state: string; imageUrl?: string; error?: string }> {
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

      const imageBase64 = data.output.image_base64;
      if (!imageBase64) {
        console.error(`Job ${jobId} completed but no image_base64 in output`);
        return { state: 'fail', error: 'No image data returned' };
      }

      try {
        const imageUrl = await uploadImageToStorage(imageBase64, supabaseUrl, supabaseKey, customFilename, projectId);
        console.log(`Job ${jobId} completed, uploaded to: ${imageUrl}`);
        return { state: 'success', imageUrl };
      } catch (uploadErr) {
        console.error(`Failed to upload image for job ${jobId}:`, uploadErr);
        return { state: 'fail', error: `Upload failed: ${uploadErr instanceof Error ? uploadErr.message : 'Unknown error'}` };
      }
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

// Upload base64 image to Supabase storage
async function uploadImageToStorage(
  base64: string,
  supabaseUrl: string,
  supabaseKey: string,
  customFilename?: string,
  projectId?: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const binaryString = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  let fileName: string;
  if (customFilename && projectId) {
    fileName = `${projectId}/images/${customFilename}`;
  } else if (customFilename) {
    fileName = `generated-images/${customFilename}`;
  } else {
    fileName = `generated-images/${crypto.randomUUID()}.png`;
  }

  console.log(`Uploading image to storage: ${fileName} (${bytes.length} bytes)`);

  const { error } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, bytes, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Supabase storage upload error:', error);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL for uploaded image');
  }

  return data.publicUrl;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const runpodApiKey = process.env.RUNPOD_API_KEY;
    if (!runpodApiKey) {
      return res.status(500).json({ error: 'RUNPOD_API_KEY not configured' });
    }

    if (!RUNPOD_ENDPOINT_ID || !RUNPOD_API_URL) {
      return res.status(500).json({ error: 'RUNPOD_ZIMAGE_ENDPOINT_ID not configured' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    // Allocate all 10 workers to image endpoint before generation starts
    try {
      await allocateWorkersForImages(runpodApiKey);
    } catch (err) {
      console.warn('Failed to allocate workers, continuing with current allocation:', err);
      // Don't fail the request if worker allocation fails - continue with whatever is configured
    }

    const { prompts, quality, aspectRatio = "16:9", stream = false, projectId }: GenerateImagesRequest = req.body;

    if (!prompts || prompts.length === 0) {
      return res.status(400).json({ error: 'No prompts provided' });
    }

    // Normalize prompts
    const isTimedPrompts = typeof prompts[0] === 'object' && 'prompt' in prompts[0];
    const normalizedPrompts: { prompt: string; filename: string }[] = isTimedPrompts
      ? (prompts as ImagePromptWithTiming[]).map(p => ({
          prompt: p.prompt,
          filename: `image_${String(p.index).padStart(3, '0')}_${p.startTime}_to_${p.endTime}.png`
        }))
      : (prompts as string[]).map((prompt, i) => ({
          prompt,
          filename: `image_${String(i + 1).padStart(3, '0')}.png`
        }));

    const total = normalizedPrompts.length;
    console.log(`Generating ${total} images with Z-Image (quality: ${quality}, aspect: ${aspectRatio}, stream: ${stream}, timed: ${isTimedPrompts})`);

    if (stream) {
      return handleStreamingImages(req, res, normalizedPrompts, total, runpodApiKey, quality, aspectRatio, supabaseUrl, supabaseKey, projectId);
    } else {
      return handleNonStreamingImages(req, res, normalizedPrompts, runpodApiKey, quality, aspectRatio, supabaseUrl, supabaseKey, projectId);
    }

  } catch (error) {
    console.error('Error in generate-images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Handle streaming image generation with rolling concurrency window
async function handleStreamingImages(
  req: Request,
  res: Response,
  normalizedPrompts: { prompt: string; filename: string }[],
  total: number,
  runpodApiKey: string,
  quality: string,
  aspectRatio: string,
  supabaseUrl: string,
  supabaseKey: string,
  projectId?: string
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const MAX_CONCURRENT_JOBS = 10; // Use all 10 RunPod workers for maximum speed
  const POLL_INTERVAL = 2000; // 2 seconds
  const MAX_POLLING_TIME = 10 * 60 * 1000; // 10 minutes total

  try {
    console.log(`\n=== Generating ${total} images with rolling concurrency (max ${MAX_CONCURRENT_JOBS} concurrent) ===`);

    sendEvent({
      type: 'progress',
      completed: 0,
      total,
      message: `Starting image generation (${MAX_CONCURRENT_JOBS} workers)...`
    });

    const allResults: JobStatus[] = [];
    let nextPromptIndex = 0;
    const activeJobs = new Map<string, { index: number; filename: string; startTime: number }>();
    const startTime = Date.now();

    // Helper to start next job
    const startNextJob = async (): Promise<void> => {
      if (nextPromptIndex >= normalizedPrompts.length) return;

      const promptData = normalizedPrompts[nextPromptIndex];
      const index = nextPromptIndex;
      nextPromptIndex++;

      try {
        const jobId = await startImageJob(runpodApiKey, promptData.prompt, quality, aspectRatio);
        activeJobs.set(jobId, { index, filename: promptData.filename, startTime: Date.now() });
        console.log(`Started job ${index + 1}/${total} (${activeJobs.size} active): ${promptData.filename}`);
      } catch (err) {
        console.error(`Failed to create job ${index + 1}:`, err);
        allResults.push({
          jobId: '',
          index,
          state: 'fail',
          error: err instanceof Error ? err.message : 'Failed to create job',
          filename: promptData.filename
        });
      }
    };

    // Fill initial window with jobs
    const initialBatch = Math.min(MAX_CONCURRENT_JOBS, normalizedPrompts.length);
    console.log(`Starting initial batch of ${initialBatch} jobs...`);
    await Promise.all(Array.from({ length: initialBatch }, () => startNextJob()));

    // Poll active jobs and start new ones as they complete
    while (activeJobs.size > 0 && Date.now() - startTime < MAX_POLLING_TIME) {
      const jobIds = Array.from(activeJobs.keys());

      // Check all active jobs in parallel
      const checkResults = await Promise.all(
        jobIds.map(async (jobId) => {
          const jobData = activeJobs.get(jobId)!;
          const status = await checkJobStatus(
            runpodApiKey,
            jobId,
            supabaseUrl,
            supabaseKey,
            jobData.filename,
            projectId
          );
          return { jobId, jobData, status };
        })
      );

      // Process completed jobs
      for (const { jobId, jobData, status } of checkResults) {
        if (status.state === 'success') {
          const duration = ((Date.now() - jobData.startTime) / 1000).toFixed(1);
          console.log(`✓ Job ${jobData.index + 1}/${total} completed in ${duration}s: ${jobData.filename}`);

          allResults.push({
            jobId,
            index: jobData.index,
            state: 'success',
            imageUrl: status.imageUrl,
            filename: jobData.filename
          });

          activeJobs.delete(jobId);

          // Start next job in the queue
          await startNextJob();

          // Send progress update
          const completed = allResults.length;
          const batchNum = Math.floor(completed / MAX_CONCURRENT_JOBS) + 1;
          sendEvent({
            type: 'progress',
            completed,
            total,
            message: `Batch ${batchNum}: ${completed}/${total} images done`
          });

        } else if (status.state === 'fail') {
          console.error(`✗ Job ${jobData.index + 1}/${total} failed: ${status.error}`);

          allResults.push({
            jobId,
            index: jobData.index,
            state: 'fail',
            error: status.error,
            filename: jobData.filename
          });

          activeJobs.delete(jobId);

          // Start next job even if this one failed
          await startNextJob();

          // Send progress update
          const completed = allResults.length;
          sendEvent({
            type: 'progress',
            completed,
            total,
            message: `${completed}/${total} images processed (${allResults.filter(r => r.state === 'fail').length} failed)`
          });
        }
      }

      // Wait before next poll if there are still active jobs
      if (activeJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    // Timeout check
    if (activeJobs.size > 0) {
      console.warn(`Timeout: ${activeJobs.size} jobs still pending after ${MAX_POLLING_TIME / 1000}s`);
      for (const [jobId, jobData] of activeJobs) {
        allResults.push({
          jobId,
          index: jobData.index,
          state: 'fail',
          error: 'Job timed out',
          filename: jobData.filename
        });
      }
    }

    // Sort results by original index
    const sortedResults = [...allResults].sort((a, b) => a.index - b.index);
    const successfulImages = sortedResults
      .filter(r => r.state === 'success' && r.imageUrl)
      .map(r => r.imageUrl!);

    const failedCount = sortedResults.filter(r => r.state === 'fail').length;

    console.log(`\n=== Image generation complete ===`);
    console.log(`Success: ${successfulImages.length}/${total}`);
    console.log(`Failed: ${failedCount}/${total}`);

    sendEvent({
      type: 'complete',
      success: true,
      images: successfulImages,
      total: successfulImages.length,
      failed: failedCount
    });

    res.end();

  } catch (err) {
    console.error('Stream error:', err);
    sendEvent({
      type: 'error',
      error: err instanceof Error ? err.message : 'Generation failed'
    });
    res.end();
  }
}

// Handle non-streaming image generation
async function handleNonStreamingImages(
  req: Request,
  res: Response,
  normalizedPrompts: { prompt: string; filename: string }[],
  runpodApiKey: string,
  quality: string,
  aspectRatio: string,
  supabaseUrl: string,
  supabaseKey: string,
  projectId?: string
) {
  const jobData = await Promise.all(
    normalizedPrompts.map(async (item, index) => {
      const jobId = await startImageJob(runpodApiKey, item.prompt, quality, aspectRatio);
      return { jobId, filename: item.filename, index };
    })
  );

  // Poll all in parallel
  const maxPollingTime = 5 * 60 * 1000;
  const pollInterval = 3000;
  const startTime = Date.now();
  const results: (string | null)[] = new Array(jobData.length).fill(null);
  const completed: boolean[] = new Array(jobData.length).fill(false);

  while (Date.now() - startTime < maxPollingTime) {
    const pendingIndices = completed.map((c, i) => c ? -1 : i).filter(i => i >= 0);

    if (pendingIndices.length === 0) break;

    const checks = await Promise.all(
      pendingIndices.map(async (i) => {
        const { jobId, filename } = jobData[i];
        const status = await checkJobStatus(runpodApiKey, jobId, supabaseUrl, supabaseKey, filename, projectId);
        return { index: i, status };
      })
    );

    for (const { index, status } of checks) {
      if (status.state === 'success' || status.state === 'fail') {
        completed[index] = true;
        results[index] = status.imageUrl || null;
      }
    }

    if (pendingIndices.length > 0) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  const imageUrls = results.filter((url): url is string => url !== null);
  console.log(`Z-Image generated ${imageUrls.length} images`);

  return res.json({ success: true, images: imageUrls });
}

export default router;
