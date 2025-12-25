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
// Parallel chunk rendering for speed (limited to avoid memory pressure)
const PARALLEL_CHUNK_RENDERS = 2;  // Reduced from 3 due to two-pass embers rendering
// Embers overlay effect URL (served from Netlify)
const EMBERS_OVERLAY_URL = 'https://historygenai.netlify.app/overlays/embers.mp4';
// Enable/disable embers overlay (set to false to debug rendering issues)
const EMBERS_ENABLED = true;
// Timeout for embers pass per chunk (ms) - fail gracefully if exceeded
const EMBERS_TIMEOUT_MS = 120000;  // 2 minutes per chunk

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

  // Keepalive heartbeat - every 5 seconds to prevent connection drops
  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 5000);

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

    // Download embers overlay
    const embersPath = path.join(tempDir, 'embers.mp4');
    try {
      await downloadFile(EMBERS_OVERLAY_URL, embersPath);
      console.log('Embers overlay downloaded');
    } catch (err) {
      console.warn('Failed to download embers overlay, continuing without it:', err);
    }

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

    // Write SRT file (kept for future use, but not burned into video)
    const srtPath = path.join(tempDir, 'captions.srt');
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('SRT file written');

    // Stage 2: Chunked video rendering
    sendEvent(res, { type: 'progress', stage: 'preparing', percent: 30, message: 'Preparing timeline...' });

    const totalImages = imagePaths.length;
    const numChunks = Math.ceil(totalImages / IMAGES_PER_CHUNK);
    const totalDuration = imageTimings[imageTimings.length - 1].endSeconds;

    console.log(`Processing ${totalImages} images in ${numChunks} chunk(s) of up to ${IMAGES_PER_CHUNK} images each (${PARALLEL_CHUNK_RENDERS} parallel)`);

    // Prepare all chunk data first
    interface ChunkData {
      index: number;
      concatPath: string;
      outputPath: string;
    }
    const chunkDataList: ChunkData[] = [];

    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const chunkStart = chunkIndex * IMAGES_PER_CHUNK;
      const chunkEnd = Math.min((chunkIndex + 1) * IMAGES_PER_CHUNK, totalImages);
      const chunkImages = imagePaths.slice(chunkStart, chunkEnd);
      const chunkTimings = imageTimings.slice(chunkStart, chunkEnd);

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

      chunkDataList.push({
        index: chunkIndex,
        concatPath,
        outputPath: chunkOutputPath
      });
    }

    const chunkVideoPaths = chunkDataList.map(c => c.outputPath);

    // Track completed chunks for progress
    let completedChunks = 0;

    // Check if embers overlay is available and enabled
    const embersAvailable = EMBERS_ENABLED && fs.existsSync(embersPath);
    if (!EMBERS_ENABLED) {
      console.log('Embers overlay disabled via EMBERS_ENABLED flag');
    } else if (embersAvailable) {
      console.log('Embers overlay available, will apply to each chunk');
    } else {
      console.log('Embers overlay not available, rendering without embers');
    }

    // Helper function to render a single chunk (with optional embers overlay)
    const renderChunk = async (chunk: ChunkData): Promise<void> => {
      console.log(`Rendering chunk ${chunk.index + 1}/${numChunks}${embersAvailable ? ' with embers' : ''}`);

      // Pass 1: Render images to raw chunk
      const rawChunkPath = path.join(tempDir!, `chunk_raw_${chunk.index}.mp4`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(chunk.concatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-threads', '0',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
            '-y'
          ])
          .output(rawChunkPath)
          .on('start', (cmd) => {
            console.log(`Chunk ${chunk.index + 1} Pass 1:`, cmd.substring(0, 150) + '...');
          })
          .on('error', (err) => {
            console.error(`Chunk ${chunk.index + 1} Pass 1 error:`, err);
            reject(err);
          })
          .on('end', () => {
            console.log(`Chunk ${chunk.index + 1} Pass 1 complete`);
            resolve();
          })
          .run();
      });

      // Pass 2: Apply embers overlay (if available)
      if (embersAvailable) {
        try {
          await new Promise<void>((resolve, reject) => {
            ffmpeg()
              .input(rawChunkPath)
              .input(embersPath)
              .inputOptions(['-stream_loop', '-1'])  // Loop embers
              .complexFilter([
                // Convert embers from TV range to full range, then use screen blend
                // Screen blend: bright pixels lighten, black stays black (no tint)
                '[1:v]scale=1920:1080:in_range=tv:out_range=full,format=yuv420p[embers]',
                '[0:v][embers]blend=all_mode=screen:shortest=1[out]'
              ])
              .outputOptions([
                '-map', '[out]',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '23',
                '-pix_fmt', 'yuv420p',
                '-y'
              ])
              .output(chunk.outputPath)
              .on('start', (cmd) => {
                console.log(`Chunk ${chunk.index + 1} Pass 2 (embers):`, cmd.substring(0, 150) + '...');
              })
              .on('error', (err) => {
                console.error(`Chunk ${chunk.index + 1} Pass 2 error:`, err);
                reject(err);
              })
              .on('end', () => {
                console.log(`Chunk ${chunk.index + 1} Pass 2 complete`);
                // Clean up raw chunk to free disk space
                try { fs.unlinkSync(rawChunkPath); } catch (e) { /* ignore */ }
                resolve();
              })
              .run();
          });
        } catch (err) {
          // Fallback: use raw chunk if embers pass fails
          console.error(`Chunk ${chunk.index + 1} embers failed, using raw:`, err);
          fs.renameSync(rawChunkPath, chunk.outputPath);
        }
      } else {
        // No embers, just rename raw chunk to final output
        fs.renameSync(rawChunkPath, chunk.outputPath);
      }

      completedChunks++;
      const percent = 30 + Math.round((completedChunks / numChunks) * 40);
      sendEvent(res, {
        type: 'progress',
        stage: 'rendering',
        percent,
        message: `Rendered ${completedChunks}/${numChunks} chunks${embersAvailable ? ' with embers' : ''}`
      });
      console.log(`Chunk ${chunk.index + 1} fully complete (${completedChunks}/${numChunks})`);
    };

    // Render chunks in parallel batches
    sendEvent(res, {
      type: 'progress',
      stage: 'rendering',
      percent: 30,
      message: `Rendering ${numChunks} chunks (${PARALLEL_CHUNK_RENDERS} parallel)...`
    });

    for (let i = 0; i < chunkDataList.length; i += PARALLEL_CHUNK_RENDERS) {
      const batch = chunkDataList.slice(i, i + PARALLEL_CHUNK_RENDERS);
      console.log(`Starting batch: chunks ${batch.map(c => c.index + 1).join(', ')}`);
      await Promise.all(batch.map(chunk => renderChunk(chunk)));
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

    // Stage 4: Add audio to concatenated video (fast muxing)
    sendEvent(res, { type: 'progress', stage: 'rendering', percent: 75, message: 'Adding audio...' });

    const withAudioPath = path.join(tempDir, 'with_audio.mp4');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatenatedPath)
        .input(audioPath)
        .outputOptions([
          '-c:v', 'copy',  // No re-encoding, just mux
          '-c:a', 'aac',
          '-ar', '48000',
          '-b:a', '192k',
          '-shortest',
          '-y'
        ])
        .output(withAudioPath)
        .on('start', (cmd) => {
          console.log('Audio mux FFmpeg command:', cmd);
        })
        .on('error', (err) => {
          console.error('Audio mux FFmpeg error:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Audio muxing complete');
          resolve();
        })
        .run();
    });

    // Check video with audio file
    const withAudioStats = fs.statSync(withAudioPath);
    console.log(`Video with audio size: ${(withAudioStats.size / 1024 / 1024).toFixed(2)} MB`);

    if (withAudioStats.size === 0) {
      throw new Error('FFmpeg produced empty video file');
    }

    // Embers overlay is now applied per-chunk during rendering (above)
    // No post-concat embers processing needed
    const finalVideoPath = withAudioPath;

    // Stage 6: Upload final video
    sendEvent(res, { type: 'progress', stage: 'uploading', percent: 85, message: 'Uploading video...' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log(`Service role key length: ${supabaseKey.length} chars`);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upload final video - with progress heartbeat for large files
    const videoUploadPath = `${projectId}/video.mp4`;
    const finalVideoBuffer = fs.readFileSync(finalVideoPath);
    const uploadSizeMB = (finalVideoBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${uploadSizeMB} MB video...`);

    // Heartbeat during upload (large files can take minutes)
    const uploadHeartbeat = setInterval(() => {
      sendEvent(res, {
        type: 'progress',
        stage: 'uploading',
        percent: 79,
        message: `Uploading video (${uploadSizeMB} MB)...`
      });
    }, 3000);

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(videoUploadPath, finalVideoBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    clearInterval(uploadHeartbeat);

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      throw new Error(`Failed to upload video: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(videoUploadPath);

    const videoUrl = urlData.publicUrl;
    console.log(`Video uploaded: ${videoUrl}`);

    // Send final completion event
    sendEvent(res, {
      type: 'complete',
      videoUrl,
      size: finalVideoBuffer.length,
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
