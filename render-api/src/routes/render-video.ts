import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const router = Router();

// Set ffmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

interface ImageTiming {
  startSeconds: number;
  endSeconds: number;
}

interface RenderVideoRequest {
  projectId: string;
  audioUrl: string;
  imageUrls: string[];
  imageTimings: ImageTiming[];
  srtContent: string;
  projectTitle: string;
}

// Helper to send SSE events
const sendEvent = (res: Response, data: any) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

// Download file from URL to temp directory
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

// Main render handler
async function handleRenderVideo(req: Request, res: Response) {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Keepalive heartbeat
  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  let tempDir: string | null = null;

  try {
    const {
      projectId,
      audioUrl,
      imageUrls,
      imageTimings,
      srtContent,
      projectTitle
    } = req.body as RenderVideoRequest;

    // Validate input
    if (!projectId || !audioUrl || !imageUrls || imageUrls.length === 0) {
      sendEvent(res, { type: 'error', error: 'Missing required fields' });
      res.end();
      return;
    }

    if (!imageTimings || imageTimings.length !== imageUrls.length) {
      sendEvent(res, { type: 'error', error: 'Image timings must match image count' });
      res.end();
      return;
    }

    console.log(`Starting video render for project: ${projectId}`);
    console.log(`Images: ${imageUrls.length}, Audio: ${audioUrl}`);

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    console.log(`Temp directory: ${tempDir}`);

    // Stage 1: Download files
    sendEvent(res, { type: 'progress', stage: 'downloading', percent: 5, message: 'Downloading assets...' });

    // Download audio
    const audioPath = path.join(tempDir, 'voiceover.wav');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded');

    // Download images
    const imagePaths: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const filename = `image_${String(i + 1).padStart(3, '0')}.png`;
      const imagePath = path.join(tempDir, filename);
      await downloadFile(imageUrls[i], imagePath);
      imagePaths.push(imagePath);

      const downloadPercent = 5 + Math.round((i + 1) / imageUrls.length * 20);
      sendEvent(res, {
        type: 'progress',
        stage: 'downloading',
        percent: downloadPercent,
        message: `Downloaded image ${i + 1}/${imageUrls.length}`
      });
    }
    console.log('All images downloaded');

    // Write SRT file
    const srtPath = path.join(tempDir, 'captions.srt');
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('SRT file written');

    // Stage 2: Create concat demuxer file
    sendEvent(res, { type: 'progress', stage: 'preparing', percent: 30, message: 'Preparing timeline...' });

    const concatContent = imagePaths.map((imgPath, i) => {
      const duration = imageTimings[i].endSeconds - imageTimings[i].startSeconds;
      // Ensure minimum duration of 0.1 seconds
      const safeDuration = Math.max(duration, 0.1);
      return `file '${imgPath}'\nduration ${safeDuration.toFixed(3)}`;
    }).join('\n');

    // Add last image again (FFmpeg concat demuxer quirk)
    const lastImagePath = imagePaths[imagePaths.length - 1];
    const concatFile = concatContent + `\nfile '${lastImagePath}'`;

    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatFile, 'utf8');
    console.log('Concat file written');

    // Stage 3: Render video with FFmpeg
    sendEvent(res, { type: 'progress', stage: 'rendering', percent: 35, message: 'Rendering video...' });

    const outputPath = path.join(tempDir, 'output.mp4');

    await new Promise<void>((resolve, reject) => {
      // Calculate total duration for progress estimation
      const totalDuration = imageTimings[imageTimings.length - 1].endSeconds;

      // Escape the SRT path for FFmpeg subtitles filter (Linux-compatible)
      // FFmpeg subtitles filter needs colons and backslashes escaped
      const escapedSrtPath = srtPath
        .replace(/\\/g, '/')  // Use forward slashes
        .replace(/:/g, '\\:')  // Escape colons
        .replace(/'/g, "'\\''");  // Escape single quotes for shell

      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .complexFilter([
          // Scale images to 1920x1080, center them if aspect ratio differs
          '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[scaled]',
          // Burn in subtitles with styling
          `[scaled]subtitles='${escapedSrtPath}':force_style='FontSize=28,FontName=Arial,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=3,Outline=2,Shadow=1,Alignment=2,MarginV=50'[final]`
        ])
        .outputOptions([
          '-map', '[final]',
          '-map', '1:a',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',  // QuickTime compatibility
          '-c:a', 'aac',
          '-ar', '48000',  // Standard audio sample rate
          '-b:a', '192k',
          '-movflags', '+faststart',
          '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg command:', cmd);
        })
        .on('progress', (progress) => {
          // Estimate progress based on time processed
          let renderPercent = 35;
          if (progress.timemark) {
            const timeMatch = progress.timemark.match(/(\d+):(\d+):(\d+)/);
            if (timeMatch) {
              const processedSeconds =
                parseInt(timeMatch[1]) * 3600 +
                parseInt(timeMatch[2]) * 60 +
                parseInt(timeMatch[3]);
              renderPercent = 35 + Math.round((processedSeconds / totalDuration) * 50);
              renderPercent = Math.min(renderPercent, 85);
            }
          }
          sendEvent(res, {
            type: 'progress',
            stage: 'rendering',
            percent: renderPercent,
            message: `Rendering: ${progress.timemark || '00:00:00'}`,
            frames: progress.frames
          });
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('FFmpeg rendering complete');
          resolve();
        })
        .run();
    });

    // Check output file exists and has content
    const outputStats = fs.statSync(outputPath);
    console.log(`Output video size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);

    if (outputStats.size === 0) {
      throw new Error('FFmpeg produced empty output file');
    }

    // Stage 4: Upload to Supabase
    sendEvent(res, { type: 'progress', stage: 'uploading', percent: 90, message: 'Uploading video...' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const storagePath = `${projectId}/video.mp4`;

    // Stream upload to Supabase (avoid loading huge video into memory)
    const uploadUrl = `${supabaseUrl}/storage/v1/object/generated-assets/${storagePath}`;
    const videoStream = fs.createReadStream(outputPath);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
        'Content-Length': outputStats.size.toString()
      },
      body: videoStream as any,
      // @ts-ignore - duplex is needed for streaming body in Node.js fetch
      duplex: 'half'
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload video: ${uploadResponse.status} ${errorText}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(storagePath);

    const videoUrl = urlData.publicUrl;
    console.log(`Video uploaded: ${videoUrl}`);

    // Send completion event
    sendEvent(res, {
      type: 'complete',
      videoUrl,
      size: outputStats.size,
      message: 'Video rendering complete!'
    });

  } catch (error: any) {
    console.error('Render video error:', error);
    sendEvent(res, { type: 'error', error: error.message || 'Unknown error' });
  } finally {
    clearInterval(heartbeatInterval);

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('Temp directory cleaned up');
      } catch (cleanupError) {
        console.error('Failed to clean up temp directory:', cleanupError);
      }
    }

    res.end();
  }
}

// POST /render-video
router.post('/', handleRenderVideo);

export default router;
