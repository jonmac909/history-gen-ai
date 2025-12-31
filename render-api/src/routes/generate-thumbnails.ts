import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = Router();

// RunPod Z-Image endpoint configuration
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID;
const RUNPOD_API_URL = RUNPOD_ENDPOINT_ID ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}` : null;

interface GenerateThumbnailsRequest {
  exampleImageBase64: string;
  contentPrompt: string;
  stylePrompt?: string; // Pre-analyzed style prompt (skips vision analysis if provided)
  thumbnailCount: number;
  projectId: string;
  stream?: boolean;
}

// Start a RunPod job for Z-Image generation
async function startImageJob(apiKey: string, prompt: string, quality: string, aspectRatio: string): Promise<string> {
  console.log(`Starting RunPod thumbnail job: ${prompt.substring(0, 80)}...`);

  const response = await fetch(`${RUNPOD_API_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        quality,
        aspectRatio,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('RunPod job creation error:', response.status, errorText);
    throw new Error(`Failed to start thumbnail job: ${response.status}`);
  }

  const data = await response.json() as any;

  if (!data.id) {
    throw new Error('RunPod job creation failed: no job ID returned');
  }

  console.log(`RunPod thumbnail job created: ${data.id}`);
  return data.id;
}

// Check RunPod job status and upload image if complete
async function checkJobStatus(
  apiKey: string,
  jobId: string,
  supabaseUrl: string,
  supabaseKey: string,
  filename: string,
  projectId: string
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
        console.error(`Thumbnail job ${jobId} completed with error:`, data.output.error);
        return { state: 'fail', error: data.output.error };
      }

      const imageBase64 = data.output.image_base64;
      if (!imageBase64) {
        console.error(`Thumbnail job ${jobId} completed but no image_base64 in output`);
        return { state: 'fail', error: 'No image data returned' };
      }

      try {
        const imageUrl = await uploadThumbnailToStorage(imageBase64, supabaseUrl, supabaseKey, filename, projectId);
        console.log(`Thumbnail job ${jobId} completed, uploaded to: ${imageUrl}`);
        return { state: 'success', imageUrl };
      } catch (uploadErr) {
        console.error(`Failed to upload thumbnail for job ${jobId}:`, uploadErr);
        return { state: 'fail', error: `Upload failed: ${uploadErr instanceof Error ? uploadErr.message : 'Unknown error'}` };
      }
    } else if (data.status === 'FAILED') {
      const errorMsg = data.error || data.output?.error || 'Job failed';
      console.error(`Thumbnail job ${jobId} failed:`, errorMsg);
      return { state: 'fail', error: errorMsg };
    } else if (data.status === 'CANCELLED' || data.status === 'TIMED_OUT') {
      console.error(`Thumbnail job ${jobId} ${data.status.toLowerCase()}`);
      return { state: 'fail', error: `Job ${data.status.toLowerCase()}` };
    }

    return { state: 'pending' };
  } catch (err) {
    console.error(`Error checking thumbnail job ${jobId}:`, err);
    return { state: 'pending' };
  }
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

// Analyze example thumbnail with Claude Vision
async function analyzeExampleThumbnail(anthropicApiKey: string, imageBase64: string): Promise<string> {
  console.log('Analyzing example thumbnail with Claude Vision...');

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  // Detect media type from base64 header or default to png
  let mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' = 'image/png';
  if (imageBase64.startsWith('/9j/')) {
    mediaType = 'image/jpeg';
  } else if (imageBase64.startsWith('UklGR')) {
    mediaType = 'image/webp';
  } else if (imageBase64.startsWith('R0lGOD')) {
    mediaType = 'image/gif';
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: `Analyze this YouTube thumbnail and describe its visual style in detail for recreating similar thumbnails. Focus on:

1. **Color palette**: Dominant colors, color grading, saturation levels, warm/cool tones
2. **Composition**: Subject placement, rule of thirds usage, visual hierarchy, focal points
3. **Typography style** (if present): Font style (bold, serif, sans-serif), size, colors, effects (shadows, outlines, glows)
4. **Lighting and mood**: Dramatic, bright, dark, cinematic, natural, studio-lit
5. **Visual effects**: Borders, vignettes, glows, shadows, gradients, overlays
6. **Overall aesthetic**: Professional, casual, dramatic, documentary, historical, cinematic

Output a detailed style prompt (150-250 words) that can be used to generate similar thumbnails. Write it as a comma-separated list of style descriptors, suitable for image generation. Do NOT describe the specific content/subject - only the visual STYLE.

Example format: "Cinematic documentary style, warm golden color grading, dramatic chiaroscuro lighting, rule of thirds composition, bold sans-serif white text with black outline, slight vignette effect, professional photography aesthetic, rich contrast with deep shadows and bright highlights"`
        }
      ]
    }]
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude Vision');
  }

  console.log('Style analysis complete:', textContent.text.substring(0, 100) + '...');
  return textContent.text;
}

// Analyze endpoint - just extract style from an image
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log('Analyzing thumbnail style...');
    const stylePrompt = await analyzeExampleThumbnail(anthropicApiKey, imageBase64);

    return res.json({
      success: true,
      stylePrompt
    });
  } catch (error) {
    console.error('Error in analyze:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Generate content prompt from script
router.post('/suggest-content', async (req: Request, res: Response) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { script, title } = req.body;

    if (!script || script.trim().length === 0) {
      return res.status(400).json({ error: 'No script provided' });
    }

    console.log('Generating thumbnail content suggestion from script...');

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // Truncate script if too long (use first ~2000 chars for context)
    const truncatedScript = script.length > 2000 ? script.substring(0, 2000) + '...' : script;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Based on this video script${title ? ` titled "${title}"` : ''}, suggest a compelling YouTube thumbnail concept. The thumbnail should capture the essence of the content and be visually striking.

Script:
${truncatedScript}

Provide a concise thumbnail description (2-3 sentences) focusing on:
- The main subject/scene to show
- Key visual elements that would grab attention
- The mood/atmosphere

Write it as a direct description for an image generator, NOT as suggestions. Example: "A dramatic close-up of a Roman emperor in golden armor, standing before a burning city at sunset, with smoke rising in the background."

Output ONLY the thumbnail description, nothing else.`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    console.log('Content suggestion generated:', textContent.text.substring(0, 100) + '...');

    return res.json({
      success: true,
      contentPrompt: textContent.text.trim()
    });
  } catch (error) {
    console.error('Error in suggest-content:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const runpodApiKey = process.env.RUNPOD_API_KEY;
    if (!runpodApiKey) {
      return res.status(500).json({ error: 'RUNPOD_API_KEY not configured' });
    }

    if (!RUNPOD_ENDPOINT_ID || !RUNPOD_API_URL) {
      return res.status(500).json({ error: 'RUNPOD_ZIMAGE_ENDPOINT_ID not configured' });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const { exampleImageBase64, contentPrompt, stylePrompt: providedStylePrompt, thumbnailCount, projectId, stream = true }: GenerateThumbnailsRequest = req.body;

    if (!exampleImageBase64) {
      return res.status(400).json({ error: 'No example image provided' });
    }

    if (!contentPrompt || contentPrompt.trim().length === 0) {
      return res.status(400).json({ error: 'No content prompt provided' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'No project ID provided' });
    }

    const count = Math.min(Math.max(thumbnailCount || 3, 1), 10); // Clamp to 1-10

    console.log(`\n=== Generating ${count} thumbnails for project ${projectId} ===`);
    if (providedStylePrompt) {
      console.log('Using pre-analyzed style prompt (skipping vision analysis)');
    }

    if (stream) {
      return handleStreamingThumbnails(
        req, res,
        exampleImageBase64,
        contentPrompt,
        providedStylePrompt,
        count,
        projectId,
        runpodApiKey,
        anthropicApiKey,
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
  contentPrompt: string,
  providedStylePrompt: string | undefined,
  count: number,
  projectId: string,
  runpodApiKey: string,
  anthropicApiKey: string,
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
    let stylePrompt: string;

    // Phase 1: Analyze example thumbnail (skip if already provided)
    if (providedStylePrompt) {
      stylePrompt = providedStylePrompt;
      sendEvent({
        type: 'progress',
        stage: 'analyzing',
        percent: 20,
        message: 'Using pre-analyzed style prompt'
      });
    } else {
      sendEvent({
        type: 'progress',
        stage: 'analyzing',
        percent: 5,
        message: 'Analyzing example thumbnail style...'
      });

      stylePrompt = await analyzeExampleThumbnail(anthropicApiKey, exampleImageBase64);

      sendEvent({
        type: 'progress',
        stage: 'analyzing',
        percent: 20,
        message: 'Style analysis complete'
      });
    }

    // Phase 2: Generate thumbnails
    sendEvent({
      type: 'progress',
      stage: 'generating',
      percent: 25,
      message: `Starting thumbnail generation (${count} images)...`
    });

    // Combine style + content prompts
    const combinedPrompt = `${stylePrompt}\n\nSubject/Content: ${contentPrompt}\n\nYouTube thumbnail, 16:9 aspect ratio, high quality, professional`;

    // Generate thumbnails with rolling concurrency
    const MAX_CONCURRENT = 4;
    const POLL_INTERVAL = 2000;
    const MAX_POLLING_TIME = 10 * 60 * 1000; // 10 minutes

    const results: { state: string; imageUrl?: string; error?: string }[] = [];
    const activeJobs = new Map<string, { index: number; startTime: number }>();
    let nextIndex = 0;
    const startTime = Date.now();

    const startNextJob = async (): Promise<void> => {
      if (nextIndex >= count) return;

      const index = nextIndex;
      nextIndex++;
      const filename = `thumbnail_${String(index + 1).padStart(3, '0')}.png`;

      try {
        const jobId = await startImageJob(runpodApiKey, combinedPrompt, 'high', '16:9');
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
          const filename = `thumbnail_${String(jobData.index + 1).padStart(3, '0')}.png`;
          const status = await checkJobStatus(runpodApiKey, jobId, supabaseUrl, supabaseKey, filename, projectId);
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
      stylePrompt,
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
