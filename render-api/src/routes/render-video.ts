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

// Chunk size for processing large videos (25 images per chunk)
const IMAGES_PER_CHUNK = 25;

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

    // Stage 2: Chunked video rendering
    sendEvent(res, { type: 'progress', stage: 'preparing', percent: 30, message: 'Preparing timeline...' });

    const totalImages = imagePaths.length;
    const numChunks = Math.ceil(totalImages / IMAGES_PER_CHUNK);
    const totalDuration = imageTimings[imageTimings.length - 1].endSeconds;

    console.log(`Processing ${totalImages} images in ${numChunks} chunk(s) of up to ${IMAGES_PER_CHUNK} images each`);

    const chunkVideoPaths: string[] = [];

    // Render each chunk as a separate video segment
    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const chunkStart = chunkIndex * IMAGES_PER_CHUNK;
      const chunkEnd = Math.min((chunkIndex + 1) * IMAGES_PER_CHUNK, totalImages);
      const chunkImages = imagePaths.slice(chunkStart, chunkEnd);
      const chunkTimings = imageTimings.slice(chunkStart, chunkEnd);

      console.log(`Rendering chunk ${chunkIndex + 1}/${numChunks}: images ${chunkStart + 1}-${chunkEnd}`);

      // Create concat demuxer file for this chunk
      const concatContent = chunkImages.map((imgPath, i) => {
        const duration = chunkTimings[i].endSeconds - chunkTimings[i].startSeconds;
        const safeDuration = Math.max(duration, 0.1);
        return `file '${imgPath}'\nduration ${safeDuration.toFixed(3)}`;
      }).join('\n');

      // Add last image again (FFmpeg concat demuxer quirk)
      const lastImagePath = chunkImages[chunkImages.length - 1];
      const concatFile = concatContent + `\nfile '${lastImagePath}'`;

      const concatPath = path.join(tempDir, `concat_chunk_${chunkIndex}.txt`);
      fs.writeFileSync(concatPath, concatFile, 'utf8');

      const chunkOutputPath = path.join(tempDir, `chunk_${chunkIndex}.mp4`);
      chunkVideoPaths.push(chunkOutputPath);

      // Calculate progress range for this chunk (30-70% for all chunks)
      const chunkProgressStart = 30 + Math.round((chunkIndex / numChunks) * 40);
      const chunkProgressEnd = 30 + Math.round(((chunkIndex + 1) / numChunks) * 40);

      sendEvent(res, {
        type: 'progress',
        stage: 'rendering',
        percent: chunkProgressStart,
        message: `Rendering chunk ${chunkIndex + 1}/${numChunks}...`
      });

      // Render this chunk (video only, no audio yet)
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
            '-y'
          ])
          .output(chunkOutputPath)
          .on('start', (cmd) => {
            console.log(`Chunk ${chunkIndex + 1} FFmpeg command:`, cmd.substring(0, 200) + '...');
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              const chunkPercent = chunkProgressStart + Math.round((progress.percent / 100) * (chunkProgressEnd - chunkProgressStart));
              sendEvent(res, {
                type: 'progress',
                stage: 'rendering',
                percent: Math.min(chunkPercent, chunkProgressEnd),
                message: `Rendering chunk ${chunkIndex + 1}/${numChunks}: ${Math.round(progress.percent)}%`
              });
            }
          })
          .on('error', (err) => {
            console.error(`Chunk ${chunkIndex + 1} FFmpeg error:`, err);
            reject(err);
          })
          .on('end', () => {
            console.log(`Chunk ${chunkIndex + 1} rendering complete`);
            resolve();
          })
          .run();
      });
    }

    // Stage 3: Concatenate all chunk videos
    sendEvent(res, { type: 'progress', stage: 'rendering', percent: 72, message: 'Joining video segments...' });

    const chunksListPath = path.join(tempDir, 'chunks_list.txt');
    const chunksListContent = chunkVideoPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(chunksListPath, chunksListContent, 'utf8');

    const concatenatedPath = path.join(tempDir, 'concatenated.mp4');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(chunksListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy',  // Fast copy, no re-encoding
          '-y'
        ])
        .output(concatenatedPath)
        .on('start', (cmd) => {
          console.log('Concatenation FFmpeg command:', cmd);
        })
        .on('error', (err) => {
          console.error('Concatenation FFmpeg error:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Video concatenation complete');
          resolve();
        })
        .run();
    });

    // Stage 4: Add audio and burn subtitles to final video
    sendEvent(res, { type: 'progress', stage: 'rendering', percent: 78, message: 'Adding audio and captions...' });

    const outputPath = path.join(tempDir, 'output.mp4');

    // Escape the SRT path for FFmpeg subtitles filter (Linux-compatible)
    const escapedSrtPath = srtPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatenatedPath)
        .input(audioPath)
        .complexFilter([
          `[0:v]subtitles='${escapedSrtPath}':force_style='FontSize=28,FontName=Arial,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=3,Outline=2,Shadow=1,Alignment=2,MarginV=50'[final]`
        ])
        .outputOptions([
          '-map', '[final]',
          '-map', '1:a',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-ar', '48000',
          '-b:a', '192k',
          '-movflags', '+faststart',
          '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('Final FFmpeg command:', cmd);
        })
        .on('progress', (progress) => {
          let finalPercent = 78;
          if (progress.timemark) {
            const timeMatch = progress.timemark.match(/(\d+):(\d+):(\d+)/);
            if (timeMatch) {
              const processedSeconds =
                parseInt(timeMatch[1]) * 3600 +
                parseInt(timeMatch[2]) * 60 +
                parseInt(timeMatch[3]);
              finalPercent = 78 + Math.round((processedSeconds / totalDuration) * 12);
              finalPercent = Math.min(finalPercent, 89);
            }
          }
          sendEvent(res, {
            type: 'progress',
            stage: 'rendering',
            percent: finalPercent,
            message: `Adding captions: ${progress.timemark || '00:00:00'}`
          });
        })
        .on('error', (err) => {
          console.error('Final FFmpeg error:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Final video rendering complete');
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
