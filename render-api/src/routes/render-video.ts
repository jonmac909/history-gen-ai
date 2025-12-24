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
const PARALLEL_CHUNK_RENDERS = 3;

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

    // Helper function to render a single chunk
    const renderChunk = async (chunk: ChunkData): Promise<void> => {
      console.log(`Rendering chunk ${chunk.index + 1}/${numChunks}`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(chunk.concatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-threads', '0',           // Use all CPU cores
            '-c:v', 'libx264',
            '-preset', 'veryfast',     // Faster preset for intermediate files
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
            '-y'
          ])
          .output(chunk.outputPath)
          .on('start', (cmd) => {
            console.log(`Chunk ${chunk.index + 1} FFmpeg:`, cmd.substring(0, 150) + '...');
          })
          .on('error', (err) => {
            console.error(`Chunk ${chunk.index + 1} FFmpeg error:`, err);
            reject(err);
          })
          .on('end', () => {
            completedChunks++;
            const percent = 30 + Math.round((completedChunks / numChunks) * 40);
            sendEvent(res, {
              type: 'progress',
              stage: 'rendering',
              percent,
              message: `Rendered ${completedChunks}/${numChunks} chunks`
            });
            console.log(`Chunk ${chunk.index + 1} complete (${completedChunks}/${numChunks})`);
            resolve();
          })
          .run();
      });
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

    // Stage 5: Upload video WITHOUT captions first (so user has it even if captions fail)
    sendEvent(res, { type: 'progress', stage: 'uploading', percent: 78, message: 'Uploading video (without captions)...' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log(`Service role key length: ${supabaseKey.length} chars`);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upload video without captions - with progress heartbeat for large files
    const videoNoCaptionsPath = `${projectId}/video.mp4`;
    const videoNoCaptionsBuffer = fs.readFileSync(withAudioPath);
    const uploadSizeMB = (videoNoCaptionsBuffer.length / 1024 / 1024).toFixed(1);
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

    const { error: uploadError1 } = await supabase.storage
      .from('generated-assets')
      .upload(videoNoCaptionsPath, videoNoCaptionsBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    clearInterval(uploadHeartbeat);

    if (uploadError1) {
      console.error('Supabase upload error (no captions):', uploadError1);
      throw new Error(`Failed to upload video: ${uploadError1.message}`);
    }

    const { data: urlData1 } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(videoNoCaptionsPath);

    const videoUrl = urlData1.publicUrl;
    console.log(`Video (no captions) uploaded: ${videoUrl}`);

    // Send partial complete - user can download video without captions now
    sendEvent(res, {
      type: 'video_ready',
      videoUrl,
      size: withAudioStats.size,
      message: 'Video without captions ready! Now burning in captions...'
    });

    // Stage 6: Burn in subtitles
    sendEvent(res, { type: 'progress', stage: 'rendering', percent: 82, message: 'Burning in captions...' });

    const captionedOutputPath = path.join(tempDir, 'output_captioned.mp4');

    console.log(`SRT path: ${srtPath}`);

    // Read first few lines of SRT to verify content
    const srtPreview = fs.readFileSync(srtPath, 'utf8').substring(0, 500);
    console.log(`SRT content preview:\n${srtPreview}`);

    // Verify SRT file exists and has content
    const srtStats = fs.statSync(srtPath);
    console.log(`SRT file size: ${srtStats.size} bytes`);
    if (srtStats.size === 0) {
      console.warn('WARNING: SRT file is empty!');
    }

    // Progress heartbeat during long subtitle burn
    const progressHeartbeat = setInterval(() => {
      sendEvent(res, {
        type: 'progress',
        stage: 'rendering',
        percent: 85,
        message: 'Burning in captions (processing)...'
      });
    }, 10000);

    let captionedVideoUrl: string | null = null;
    let captionedSize = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        // Build subtitle filter - use videoFilters for proper escaping
        // Note: On Linux, srtPath like /tmp/render-xxx/captions.srt has no special chars
        // Fonts installed via nixpacks.toml (fontconfig, fonts-dejavu-core, fonts-liberation)
        // Don't specify FontName - fontconfig will use installed fonts as fallback
        const subtitleFilterString = `subtitles=${srtPath}:force_style='FontSize=28,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=3,Outline=2,Shadow=1,Alignment=2,MarginV=50'`;
        console.log(`Subtitle filter: ${subtitleFilterString}`);

        ffmpeg()
          .input(withAudioPath)
          .videoFilters(subtitleFilterString)
          .outputOptions([
            '-threads', '0',           // Use all CPU cores
            '-c:v', 'libx264',
            '-preset', 'fast',         // Keep fast for final output quality
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            '-y'
          ])
          .output(captionedOutputPath)
          .on('start', (cmd) => {
            console.log('Subtitle burn FFmpeg command:', cmd);
          })
          .on('stderr', (stderrLine) => {
            // Log ALL FFmpeg stderr for debugging subtitle issues
            console.log('FFmpeg subtitle stderr:', stderrLine);
          })
          .on('progress', (progress) => {
            let finalPercent = 82;
            if (progress.timemark) {
              const timeMatch = progress.timemark.match(/(\d+):(\d+):(\d+)/);
              if (timeMatch) {
                const processedSeconds =
                  parseInt(timeMatch[1]) * 3600 +
                  parseInt(timeMatch[2]) * 60 +
                  parseInt(timeMatch[3]);
                finalPercent = 82 + Math.round((processedSeconds / totalDuration) * 10);
                finalPercent = Math.min(finalPercent, 92);
              }
            }
            sendEvent(res, {
              type: 'progress',
              stage: 'rendering',
              percent: finalPercent,
              message: `Burning captions: ${progress.timemark || '00:00:00'}`
            });
          })
          .on('error', (err) => {
            clearInterval(progressHeartbeat);
            console.error('Subtitle burn FFmpeg error:', err);
            reject(err);
          })
          .on('end', () => {
            clearInterval(progressHeartbeat);
            console.log('Subtitle burning complete');
            resolve();
          })
          .run();
      });

      // Check captioned output
      const captionedStats = fs.statSync(captionedOutputPath);
      captionedSize = captionedStats.size;
      const captionedSizeMB = (captionedSize / 1024 / 1024).toFixed(1);
      console.log(`Captioned video size: ${captionedSizeMB} MB`);

      // Stage 7: Upload captioned video
      sendEvent(res, { type: 'progress', stage: 'uploading', percent: 95, message: `Uploading captioned video (${captionedSizeMB} MB)...` });

      const videoCaptionedPath = `${projectId}/video_captioned.mp4`;
      const videoCaptionedBuffer = fs.readFileSync(captionedOutputPath);

      // Heartbeat during captioned upload
      const captionedUploadHeartbeat = setInterval(() => {
        sendEvent(res, {
          type: 'progress',
          stage: 'uploading',
          percent: 96,
          message: `Uploading captioned video (${captionedSizeMB} MB)...`
        });
      }, 3000);

      const { error: uploadError2 } = await supabase.storage
        .from('generated-assets')
        .upload(videoCaptionedPath, videoCaptionedBuffer, {
          contentType: 'video/mp4',
          upsert: true
        });

      clearInterval(captionedUploadHeartbeat);

      if (uploadError2) {
        console.error('Supabase upload error (captioned):', uploadError2);
        // Don't throw - we already have the non-captioned version
        sendEvent(res, {
          type: 'caption_error',
          error: `Failed to upload captioned video: ${uploadError2.message}`,
          message: 'Captioned video upload failed, but video without captions is available'
        });
      } else {
        const { data: urlData2 } = supabase.storage
          .from('generated-assets')
          .getPublicUrl(videoCaptionedPath);

        captionedVideoUrl = urlData2.publicUrl;
        console.log(`Captioned video uploaded: ${captionedVideoUrl}`);
      }

    } catch (captionError: any) {
      clearInterval(progressHeartbeat);
      console.error('Caption burning failed:', captionError);
      sendEvent(res, {
        type: 'caption_error',
        error: captionError.message,
        message: 'Caption burning failed, but video without captions is available'
      });
    }

    // Send final completion event with both URLs
    sendEvent(res, {
      type: 'complete',
      videoUrl,
      videoUrlCaptioned: captionedVideoUrl,
      size: withAudioStats.size,
      sizeCaptioned: captionedSize,
      message: captionedVideoUrl
        ? 'Video rendering complete! Both versions available.'
        : 'Video rendering complete! (Captions failed, video without captions available)'
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
