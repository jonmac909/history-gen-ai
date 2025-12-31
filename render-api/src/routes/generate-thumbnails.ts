import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const router = Router();

// Kie.ai API configuration for Seedream 4.5
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

interface GenerateThumbnailsRequest {
  exampleImageBase64: string;
  prompt: string; // User-provided prompt describing what to generate
  thumbnailCount: number;
  projectId: string;
  stream?: boolean;
}

// Start a Kie.ai Seedream 4.5-edit task (image-to-image)
async function startImageJob(apiKey: string, prompt: string, quality: string, aspectRatio: string, referenceImageUrl: string): Promise<string> {
  console.log(`Starting Kie.ai Seedream 4.5-edit job: ${prompt.substring(0, 80)}...`);
  console.log(`Reference image: ${referenceImageUrl}`);

  const response = await fetch(`${KIE_API_URL}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'seedream/4.5-edit',
      input: {
        prompt,
        image_urls: [referenceImageUrl],
        aspect_ratio: aspectRatio,
        quality: quality.toLowerCase(), // 'basic' for 2K, 'high' for 4K
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Kie.ai task creation error:', response.status, errorText);
    throw new Error(`Failed to start thumbnail task: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  if (data.code !== 200 || !data.data?.taskId) {
    console.error('Kie.ai task creation failed:', data);
    throw new Error(`Kie.ai task creation failed: ${data.msg || 'no task ID returned'}`);
  }

  console.log(`Kie.ai Seedream 4.5-edit task created: ${data.data.taskId}`);
  return data.data.taskId;
}

// Upload base64 image to Supabase and return public URL (for Kie.ai reference)
async function uploadReferenceImage(
  base64: string,
  supabaseUrl: string,
  supabaseKey: string,
  projectId: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Decode base64 to buffer
  const imageBuffer = Buffer.from(base64, 'base64');

  // Generate unique filename for reference image
  const filename = `reference_${Date.now()}.png`;
  const filePath = `${projectId}/thumbnails/${filename}`;

  console.log(`Uploading reference image to storage: ${filePath} (${imageBuffer.length} bytes)`);

  const { error } = await supabase.storage
    .from('generated-assets')
    .upload(filePath, imageBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Supabase storage upload error:', error);
    throw new Error(`Reference image upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL for reference image');
  }

  console.log(`Reference image uploaded: ${data.publicUrl}`);
  return data.publicUrl;
}

// Check Kie.ai task status and download/upload image if complete
async function checkJobStatus(
  apiKey: string,
  taskId: string,
  supabaseUrl: string,
  supabaseKey: string,
  filename: string,
  projectId: string
): Promise<{ state: string; imageUrl?: string; error?: string }> {
  try {
    const response = await fetch(`${KIE_API_URL}/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`Kie.ai status check failed: ${response.status}`);
      return { state: 'pending' };
    }

    const data = await response.json() as any;

    if (data.code !== 200) {
      console.error(`Kie.ai status check error:`, data);
      return { state: 'pending' };
    }

    const taskData = data.data;
    const state = taskData.state;

    if (state === 'success') {
      // Parse resultJson to get image URLs
      let resultUrls: string[] = [];
      try {
        const resultJson = JSON.parse(taskData.resultJson || '{}');
        resultUrls = resultJson.resultUrls || [];
      } catch (parseErr) {
        console.error(`Failed to parse resultJson for task ${taskId}:`, parseErr);
        return { state: 'fail', error: 'Failed to parse result' };
      }

      if (resultUrls.length === 0) {
        console.error(`Task ${taskId} completed but no image URLs in result`);
        return { state: 'fail', error: 'No image URL returned' };
      }

      const imageUrl = resultUrls[0];
      console.log(`Task ${taskId} completed, downloading from: ${imageUrl}`);

      try {
        // Download image from Kie.ai URL and upload to Supabase
        const uploadedUrl = await downloadAndUploadImage(imageUrl, supabaseUrl, supabaseKey, filename, projectId);
        console.log(`Task ${taskId} completed, uploaded to: ${uploadedUrl}`);
        return { state: 'success', imageUrl: uploadedUrl };
      } catch (uploadErr) {
        console.error(`Failed to upload thumbnail for task ${taskId}:`, uploadErr);
        return { state: 'fail', error: `Upload failed: ${uploadErr instanceof Error ? uploadErr.message : 'Unknown error'}` };
      }
    } else if (state === 'fail') {
      const errorMsg = taskData.failMsg || taskData.failCode || 'Task failed';
      console.error(`Task ${taskId} failed:`, errorMsg);
      return { state: 'fail', error: errorMsg };
    }

    // States: waiting, queuing, generating - all treated as pending
    return { state: 'pending' };
  } catch (err) {
    console.error(`Error checking task ${taskId}:`, err);
    return { state: 'pending' };
  }
}

// Download image from URL and upload to Supabase
async function downloadAndUploadImage(
  imageUrl: string,
  supabaseUrl: string,
  supabaseKey: string,
  filename: string,
  projectId: string
): Promise<string> {
  // Download image from Kie.ai
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status}`);
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);

  // Upload to Supabase
  const supabase = createClient(supabaseUrl, supabaseKey);
  const filePath = `${projectId}/thumbnails/${filename}`;
  console.log(`Uploading thumbnail to storage: ${filePath} (${imageBuffer.length} bytes)`);

  const { error } = await supabase.storage
    .from('generated-assets')
    .upload(filePath, imageBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Supabase storage upload error:', error);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL for uploaded thumbnail');
  }

  return data.publicUrl;
}

// Upload base64 image to Supabase storage
async function uploadThumbnailToStorage(
  base64: string,
  supabaseUrl: string,
  supabaseKey: string,
  filename: string,
  projectId: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const binaryString = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const filePath = `${projectId}/thumbnails/${filename}`;
  console.log(`Uploading thumbnail to storage: ${filePath} (${bytes.length} bytes)`);

  const { error } = await supabase.storage
    .from('generated-assets')
    .upload(filePath, bytes, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Supabase storage upload error:', error);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL for uploaded thumbnail');
  }

  return data.publicUrl;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return res.status(500).json({ error: 'KIE_API_KEY not configured' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const { exampleImageBase64, prompt, thumbnailCount, projectId, stream = true }: GenerateThumbnailsRequest = req.body;

    if (!exampleImageBase64) {
      return res.status(400).json({ error: 'No example image provided' });
    }

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'No prompt provided' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'No project ID provided' });
    }

    const count = Math.min(Math.max(thumbnailCount || 3, 1), 10); // Clamp to 1-10

    console.log(`\n=== Generating ${count} thumbnails for project ${projectId} ===`);

    if (stream) {
      return handleStreamingThumbnails(
        req, res,
        exampleImageBase64,
        prompt,
        count,
        projectId,
        kieApiKey,
        supabaseUrl,
        supabaseKey
      );
    } else {
      return res.status(400).json({ error: 'Non-streaming mode not supported' });
    }

  } catch (error) {
    console.error('Error in generate-thumbnails:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

async function handleStreamingThumbnails(
  req: Request,
  res: Response,
  exampleImageBase64: string,
  prompt: string,
  count: number,
  projectId: string,
  kieApiKey: string,
  supabaseUrl: string,
  supabaseKey: string
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

  try {
    // Phase 1: Upload reference image to get a public URL for Kie.ai
    sendEvent({
      type: 'progress',
      stage: 'uploading',
      percent: 22,
      message: 'Uploading reference image...'
    });

    const referenceImageUrl = await uploadReferenceImage(exampleImageBase64, supabaseUrl, supabaseKey, projectId);

    sendEvent({
      type: 'progress',
      stage: 'generating',
      percent: 25,
      message: `Starting thumbnail generation (${count} images)...`
    });

    // Use the prompt directly (user provides the full description)
    const combinedPrompt = `${prompt}\n\nYouTube thumbnail, 16:9 aspect ratio, high quality, professional.`;

    // Generate thumbnails with rolling concurrency
    const MAX_CONCURRENT = 4;
    const POLL_INTERVAL = 2000;
    const MAX_POLLING_TIME = 10 * 60 * 1000; // 10 minutes

    // Use a batch timestamp to ensure unique filenames (prevents browser caching old versions)
    const batchTimestamp = Date.now();

    const results: { state: string; imageUrl?: string; error?: string }[] = [];
    const activeJobs = new Map<string, { index: number; startTime: number }>();
    let nextIndex = 0;
    const startTime = Date.now();

    const startNextJob = async (): Promise<void> => {
      if (nextIndex >= count) return;

      const index = nextIndex;
      nextIndex++;
      const filename = `thumbnail_${batchTimestamp}_${String(index + 1).padStart(3, '0')}.png`;

      try {
        const jobId = await startImageJob(kieApiKey, combinedPrompt, 'high', '16:9', referenceImageUrl);
        activeJobs.set(jobId, { index, startTime: Date.now() });
        console.log(`Started thumbnail job ${index + 1}/${count}: ${filename}`);
      } catch (err) {
        console.error(`Failed to create thumbnail job ${index + 1}:`, err);
        results[index] = { state: 'fail', error: err instanceof Error ? err.message : 'Unknown error' };
      }
    };

    // Start initial batch
    const initialBatch = Math.min(MAX_CONCURRENT, count);
    await Promise.all(Array.from({ length: initialBatch }, () => startNextJob()));

    // Poll and process results
    while (activeJobs.size > 0 && Date.now() - startTime < MAX_POLLING_TIME) {
      const jobIds = Array.from(activeJobs.keys());

      const checkResults = await Promise.all(
        jobIds.map(async (jobId) => {
          const jobData = activeJobs.get(jobId)!;
          const filename = `thumbnail_${batchTimestamp}_${String(jobData.index + 1).padStart(3, '0')}.png`;
          const status = await checkJobStatus(kieApiKey, jobId, supabaseUrl, supabaseKey, filename, projectId);
          return { jobId, jobData, status };
        })
      );

      for (const { jobId, jobData, status } of checkResults) {
        if (status.state === 'success' || status.state === 'fail') {
          results[jobData.index] = status;
          activeJobs.delete(jobId);

          if (status.state === 'success') {
            console.log(`✓ Thumbnail ${jobData.index + 1}/${count} completed`);
          } else {
            console.error(`✗ Thumbnail ${jobData.index + 1}/${count} failed: ${status.error}`);
          }

          // Start next job
          await startNextJob();

          // Update progress
          const completed = results.filter(r => r && r.state === 'success').length;
          const failed = results.filter(r => r && r.state === 'fail').length;
          const percent = 25 + Math.round((completed + failed) / count * 70);

          sendEvent({
            type: 'progress',
            stage: 'generating',
            percent,
            message: `${completed}/${count} thumbnails generated${failed > 0 ? ` (${failed} failed)` : ''}`
          });
        }
      }

      if (activeJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    // Handle timeout
    if (activeJobs.size > 0) {
      console.warn(`Timeout: ${activeJobs.size} thumbnail jobs still pending`);
      for (const [jobId, jobData] of activeJobs) {
        results[jobData.index] = { state: 'fail', error: 'Job timed out' };
      }
    }

    // Collect successful thumbnails
    const thumbnails = results
      .filter(r => r && r.state === 'success' && r.imageUrl)
      .map(r => r.imageUrl!);

    const failedCount = results.filter(r => r && r.state === 'fail').length;

    console.log(`\n=== Thumbnail generation complete ===`);
    console.log(`Success: ${thumbnails.length}/${count}`);
    console.log(`Failed: ${failedCount}/${count}`);

    sendEvent({
      type: 'complete',
      success: true,
      thumbnails,
      total: thumbnails.length,
      failed: failedCount
    });

    cleanup();
    res.end();

  } catch (err) {
    console.error('Thumbnail stream error:', err);
    sendEvent({
      type: 'error',
      error: err instanceof Error ? err.message : 'Thumbnail generation failed'
    });
    cleanup();
    res.end();
  }
}

export default router;
