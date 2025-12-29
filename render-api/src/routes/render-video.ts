import { Router, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

const router = Router();

// Set ffmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Configuration - optimized for speed
const IMAGES_PER_CHUNK = 25;
const PARALLEL_CHUNK_RENDERS = 4;  // Increased from 3 for faster rendering
const FFMPEG_PRESET = 'ultrafast';  // Changed from veryfast for ~40% faster encoding
const FFMPEG_CRF = '26';  // Changed from 23 for faster encoding (slightly lower quality)

// Embers overlay
const EMBERS_OVERLAY_URL = 'https://historygenai.netlify.app/overlays/embers.mp4';
const EMBERS_SOURCE_DURATION = 10;

interface VideoEffects {
  embers?: boolean;
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
  effects?: VideoEffects;
}

interface RenderJob {
  id: string;
  project_id: string;
  status: 'queued' | 'downloading' | 'rendering' | 'muxing' | 'uploading' | 'complete' | 'failed';
  progress: number;
  message: string | null;
  video_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Get Supabase client
function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(supabaseUrl, supabaseKey);
}

// Update job status in Supabase
async function updateJobStatus(
  supabase: SupabaseClient,
  jobId: string,
  status: RenderJob['status'],
  progress: number,
  message: string,
  extras?: { video_url?: string; error?: string }
): Promise<void> {
  // Build update object - only include video_url/error if explicitly provided
  const updateData: Record<string, unknown> = {
    status,
    progress,
    message,
    updated_at: new Date().toISOString()
  };

  // Only set video_url if explicitly provided (don't overwrite with null)
  if (extras?.video_url !== undefined) {
    updateData.video_url = extras.video_url;
  }
  if (extras?.error !== undefined) {
    updateData.error = extras.error;
  }

  const { error } = await supabase
    .from('render_jobs')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    console.error(`Failed to update job ${jobId}:`, error);
  } else {
    console.log(`Job ${jobId}: ${status} ${progress}% - ${message}`);
  }
}

// Download file from URL to temp directory
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

// Background render processing function
async function processRenderJob(jobId: string, params: RenderVideoRequest): Promise<void> {
  const supabase = getSupabase();
  let tempDir: string | null = null;

  try {
    const {
      projectId,
      audioUrl,
      imageUrls,
      imageTimings,
      srtContent,
      effects
    } = params;

    const embersEnabled = effects?.embers ?? false;
    console.log(`Job ${jobId}: Starting render for project ${projectId}`);
    console.log(`Effects: embers=${embersEnabled}, Images: ${imageUrls.length}`);

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    console.log(`Temp directory: ${tempDir}`);

    // Stage 1: Download files
    await updateJobStatus(supabase, jobId, 'downloading', 5, 'Downloading assets...');

    const audioPath = path.join(tempDir, 'voiceover.wav');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded');

    const embersPath = path.join(tempDir, 'embers.mp4');
    try {
      await downloadFile(EMBERS_OVERLAY_URL, embersPath);
      console.log('Embers overlay downloaded');
    } catch (err) {
      console.warn('Failed to download embers overlay:', err);
    }

    const imagePaths: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const filename = `image_${String(i + 1).padStart(3, '0')}.png`;
      const imagePath = path.join(tempDir, filename);
      await downloadFile(imageUrls[i], imagePath);
      imagePaths.push(imagePath);

      if (i % 10 === 0 || i === imageUrls.length - 1) {
        const downloadPercent = 5 + Math.round((i + 1) / imageUrls.length * 20);
        await updateJobStatus(supabase, jobId, 'downloading', downloadPercent, `Downloaded image ${i + 1}/${imageUrls.length}`);
      }
    }
    console.log('All images downloaded');

    fs.writeFileSync(path.join(tempDir, 'captions.srt'), srtContent, 'utf8');

    // Stage 2: Prepare chunks
    await updateJobStatus(supabase, jobId, 'rendering', 28, 'Preparing timeline...');

    const totalImages = imagePaths.length;
    const numChunks = Math.ceil(totalImages / IMAGES_PER_CHUNK);

    console.log(`Processing ${totalImages} images in ${numChunks} chunk(s) (${PARALLEL_CHUNK_RENDERS} parallel, ${FFMPEG_PRESET} preset)`);

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

      const concatContent = chunkImages.map((imgPath, i) => {
        const duration = chunkTimings[i].endSeconds - chunkTimings[i].startSeconds;
        const safeDuration = Math.max(duration, 0.1);
        return `file '${imgPath}'\nduration ${safeDuration.toFixed(3)}`;
      }).join('\n');

      const lastImagePath = chunkImages[chunkImages.length - 1];
      const concatFile = concatContent + `\nfile '${lastImagePath}'`;

      const concatPath = path.join(tempDir, `concat_chunk_${chunkIndex}.txt`);
      fs.writeFileSync(concatPath, concatFile, 'utf8');

      chunkDataList.push({
        index: chunkIndex,
        concatPath,
        outputPath: path.join(tempDir, `chunk_${chunkIndex}.mp4`)
      });
    }

    const chunkVideoPaths = chunkDataList.map(c => c.outputPath);
    let completedChunks = 0;

    const embersAvailable = embersEnabled && fs.existsSync(embersPath);

    // Render chunk function
    const renderChunk = async (chunk: ChunkData): Promise<void> => {
      const chunkStart = chunk.index * IMAGES_PER_CHUNK;
      const chunkEnd = Math.min((chunk.index + 1) * IMAGES_PER_CHUNK, totalImages);
      const chunkTimingsSlice = imageTimings.slice(chunkStart, chunkEnd);
      const chunkDuration = chunkTimingsSlice[chunkTimingsSlice.length - 1].endSeconds - chunkTimingsSlice[0].startSeconds;

      console.log(`Rendering chunk ${chunk.index + 1}/${numChunks} (${chunkDuration.toFixed(1)}s)`);

      const rawChunkPath = path.join(tempDir!, `chunk_raw_${chunk.index}.mp4`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(chunk.concatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-threads', '0',
            '-c:v', 'libx264',
            '-preset', FFMPEG_PRESET,
            '-crf', FFMPEG_CRF,
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
            '-y'
          ])
          .output(rawChunkPath)
          .on('start', (cmd) => {
            console.log(`Chunk ${chunk.index + 1} Pass 1:`, cmd.substring(0, 120) + '...');
          })
          .on('error', reject)
          .on('end', () => {
            console.log(`Chunk ${chunk.index + 1} Pass 1 complete`);
            resolve();
          })
          .run();
      });

      if (embersAvailable) {
        try {
          const embersLoopCount = Math.ceil(chunkDuration / EMBERS_SOURCE_DURATION) + 1;
          const embersChunkConcatPath = path.join(tempDir!, `embers_concat_${chunk.index}.txt`);
          fs.writeFileSync(embersChunkConcatPath, Array(embersLoopCount).fill(`file '${embersPath}'`).join('\n'), 'utf8');

          await new Promise<void>((resolve, reject) => {
            ffmpeg()
              .input(rawChunkPath)
              .input(embersChunkConcatPath)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .complexFilter([
                // Remove dark background from embers using colorkey, then overlay
                '[1:v]scale=1920:1080,colorkey=black:similarity=0.3:blend=0.2[embers_keyed]',
                '[0:v][embers_keyed]overlay=0:0:shortest=1[out]'
              ])
              .outputOptions([
                '-map', '[out]',
                '-c:v', 'libx264',
                '-preset', FFMPEG_PRESET,
                '-crf', FFMPEG_CRF,
                '-pix_fmt', 'yuv420p',
                '-y'
              ])
              .output(chunk.outputPath)
              .on('error', reject)
              .on('end', () => {
                try { fs.unlinkSync(rawChunkPath); } catch (e) { }
                try { fs.unlinkSync(embersChunkConcatPath); } catch (e) { }
                resolve();
              })
              .run();
          });
        } catch (err) {
          console.error(`Chunk ${chunk.index + 1} embers failed:`, err);
          if (fs.existsSync(rawChunkPath)) {
            fs.renameSync(rawChunkPath, chunk.outputPath);
          }
        }
      } else {
        fs.renameSync(rawChunkPath, chunk.outputPath);
      }

      completedChunks++;
      const percent = 30 + Math.round((completedChunks / numChunks) * 40);
      await updateJobStatus(supabase, jobId, 'rendering', percent, `Rendered ${completedChunks}/${numChunks} chunks`);
      console.log(`Chunk ${chunk.index + 1} fully complete (${completedChunks}/${numChunks})`);
    };

    // Render chunks in parallel batches
    await updateJobStatus(supabase, jobId, 'rendering', 30, `Rendering ${numChunks} chunks...`);

    for (let i = 0; i < chunkDataList.length; i += PARALLEL_CHUNK_RENDERS) {
      const batch = chunkDataList.slice(i, i + PARALLEL_CHUNK_RENDERS);
      console.log(`Starting batch: chunks ${batch.map(c => c.index + 1).join(', ')}`);
      await Promise.all(batch.map(chunk => renderChunk(chunk)));
    }

    // Stage 3: Concatenate chunks
    await updateJobStatus(supabase, jobId, 'muxing', 72, 'Joining video segments...');

    const chunksListPath = path.join(tempDir, 'chunks_list.txt');
    fs.writeFileSync(chunksListPath, chunkVideoPaths.map(p => `file '${p}'`).join('\n'), 'utf8');

    const concatenatedPath = path.join(tempDir, 'concatenated.mp4');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(chunksListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-y'])
        .output(concatenatedPath)
        .on('error', reject)
        .on('end', () => {
          console.log('Video concatenation complete');
          resolve();
        })
        .run();
    });

    // Stage 4: Add audio
    await updateJobStatus(supabase, jobId, 'muxing', 75, 'Adding audio...');

    const withAudioPath = path.join(tempDir, 'with_audio.mp4');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatenatedPath)
        .input(audioPath)
        .outputOptions([
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-ar', '48000',
          '-b:a', '192k',
          '-shortest',
          '-y'
        ])
        .output(withAudioPath)
        .on('start', (cmd) => {
          console.log('Audio mux:', cmd.substring(0, 100) + '...');
        })
        .on('error', reject)
        .on('end', () => {
          console.log('Audio muxing complete');
          resolve();
        })
        .run();
    });

    const withAudioStats = fs.statSync(withAudioPath);
    console.log(`Video with audio: ${(withAudioStats.size / 1024 / 1024).toFixed(2)} MB`);

    if (withAudioStats.size === 0) {
      throw new Error('FFmpeg produced empty video file');
    }

    // Stage 5: Upload
    await updateJobStatus(supabase, jobId, 'uploading', 85, 'Uploading video...');

    const videoUploadPath = `${params.projectId}/video.mp4`;
    const finalVideoBuffer = fs.readFileSync(withAudioPath);
    const uploadSizeMB = (finalVideoBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${uploadSizeMB} MB video...`);

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(videoUploadPath, finalVideoBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Failed to upload video: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(videoUploadPath);

    const videoUrl = urlData.publicUrl;
    console.log(`Video uploaded: ${videoUrl}`);

    // Complete!
    await updateJobStatus(supabase, jobId, 'complete', 100, 'Video rendering complete!', { video_url: videoUrl });

  } catch (error: any) {
    console.error(`Job ${jobId} failed:`, error);
    await updateJobStatus(supabase, jobId, 'failed', 0, 'Render failed', { error: error.message || 'Unknown error' });
  } finally {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('Temp directory cleaned up');
      } catch (cleanupError) {
        console.error('Failed to clean up temp directory:', cleanupError);
      }
    }
  }
}

// POST /render-video - Start a new render job
router.post('/', async (req: Request, res: Response) => {
  try {
    const params = req.body as RenderVideoRequest;

    // Validate input
    if (!params.projectId || !params.audioUrl || !params.imageUrls || params.imageUrls.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!params.imageTimings || params.imageTimings.length !== params.imageUrls.length) {
      return res.status(400).json({ error: 'Image timings must match image count' });
    }

    const supabase = getSupabase();

    // Create job in database
    const jobId = randomUUID();
    const { error: insertError } = await supabase
      .from('render_jobs')
      .insert({
        id: jobId,
        project_id: params.projectId,
        status: 'queued',
        progress: 0,
        message: 'Job queued'
      });

    if (insertError) {
      console.error('Failed to create job:', insertError);
      return res.status(500).json({ error: 'Failed to create render job' });
    }

    console.log(`Created render job ${jobId} for project ${params.projectId}`);

    // Start background processing (non-blocking)
    processRenderJob(jobId, params).catch(err => {
      console.error(`Background job ${jobId} crashed:`, err);
    });

    // Return immediately with job ID
    res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Render job started. Poll /render-video/status/:jobId for progress.'
    });

  } catch (error: any) {
    console.error('Error starting render job:', error);
    res.status(500).json({ error: error.message || 'Failed to start render job' });
  }
});

// GET /render-video/status/:jobId - Poll job status
router.get('/status/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ error: 'Job ID required' });
    }

    const supabase = getSupabase();

    const { data: job, error } = await supabase
      .from('render_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);

  } catch (error: any) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch job status' });
  }
});

export default router;
