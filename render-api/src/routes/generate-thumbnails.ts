import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = Router();

// Kie.ai API configuration for Seedream 4.5
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

interface GenerateThumbnailsRequest {
  exampleImageBase64: string;
  contentPrompt: string;
  stylePrompt?: string; // Pre-analyzed style prompt (skips vision analysis if provided)
  thumbnailCount: number;
  projectId: string;
  stream?: boolean;
}

// Start a Kie.ai Seedream 4.5 task
async function startImageJob(apiKey: string, prompt: string, quality: string, aspectRatio: string): Promise<string> {
  console.log(`Starting Kie.ai Seedream 4.5 job: ${prompt.substring(0, 80)}...`);

  const response = await fetch(`${KIE_API_URL}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'seedream/4.5-text-to-image',
      input: {
        prompt,
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

  console.log(`Kie.ai Seedream 4.5 task created: ${data.data.taskId}`);
  return data.data.taskId;
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
          text: `Reverse-engineer this YouTube thumbnail into a detailed image generation prompt that could recreate it.

Describe EVERYTHING in the image:
1. Subject/content: What is shown? People, objects, scene, setting, actions, expressions
2. Composition: Layout, framing, focal point, rule of thirds, foreground/background
3. Art style: Realistic, illustrated, painterly, cartoon, etc.
4. Colors: Specific palette, color grading, saturation, warm/cool tones
5. Lighting: Direction, mood, shadows, highlights
6. Texture and rendering: Smooth, rough, crosshatched, cel-shaded, etc.
7. Mood/atmosphere: Dramatic, peaceful, mysterious, etc.
8. Text/Typography: If there is any text, describe what it says, its font style (bold, serif, sans-serif, handwritten, etc.), color, size, placement, and any effects (shadow, outline, glow)

Output a single detailed prompt (200-400 words) that an image generator could use to recreate this exact image. Write it as direct descriptive text, not a list. Include text/typography details if present.

Example: "A weathered medieval peasant man in his 40s sits huddled on a wooden bench inside a rustic cabin, clutching a thick wool blanket around his shoulders. His expression shows worry and exhaustion, with wide eyes and furrowed brows. Through a frosted window behind him, snow and icicles are visible. The scene is rendered in an editorial illustration style with bold black outlines, muted blue-gray color palette, and subtle crosshatching for texture. The lighting is cool and dim, suggesting a cold winter morning. The composition places the man in the right third of the frame, with the window providing visual interest on the left. Large bold white text reading 'MEDIEVAL LIFE' with black outline spans the top of the image."`
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

// Remix a prompt with small variations
router.post('/remix', async (req: Request, res: Response) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { prompt } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'No prompt provided' });
    }

    console.log('Remixing prompt...');

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Take this image generation prompt and create a variation of it by making small creative changes. Keep the overall style, mood, and quality but vary specific elements.

Changes to make (pick 2-4 of these):
- Swap gender (man → woman, woman → man)
- Change hair color/style
- Adjust color palette (warm → cool, blue → red, etc.)
- Shift time of day (dawn → dusk, day → night)
- Alter weather/atmosphere (sunny → stormy, clear → foggy)
- Change age (young → old, child → adult)
- Swap similar objects or animals
- Adjust clothing style or era
- Change expression/emotion
- Vary background elements

Original prompt:
${prompt}

Output ONLY the remixed prompt with variations applied. Keep the same length and detail level as the original. Do not explain what you changed.`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    console.log('Remix complete:', textContent.text.substring(0, 100) + '...');

    return res.json({
      success: true,
      remixedPrompt: textContent.text.trim()
    });
  } catch (error) {
    console.error('Error in remix:', error);
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

IMPORTANT: Do NOT mention any text, titles, words, or typography in your description. The image generator cannot reliably create text, so describe ONLY the visual artwork/scene.

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
    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return res.status(500).json({ error: 'KIE_API_KEY not configured' });
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
        kieApiKey,
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
  kieApiKey: string,
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

    // Use the prompt directly (already contains full description including any text/typography)
    const combinedPrompt = `${stylePrompt}\n\nYouTube thumbnail, 16:9 aspect ratio, high quality, professional.`;

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
        const jobId = await startImageJob(kieApiKey, combinedPrompt, 'high', '16:9');
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
