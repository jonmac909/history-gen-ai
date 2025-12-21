import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import lamejs from 'lamejs';

const router = Router();

const DEBUG = process.env.DEBUG === 'true';
const logger = {
  debug: (...args: unknown[]) => DEBUG && console.log('[DEBUG]', ...args),
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
};

// TTS Configuration Constants
const MAX_TTS_CHUNK_LENGTH = 250; // Increased from 180 for fewer chunks = faster generation
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 400;
const MAX_VOICE_SAMPLE_SIZE = 10 * 1024 * 1024;
const TTS_JOB_POLL_INTERVAL_INITIAL = 500; // Start with fast polling
const TTS_JOB_POLL_INTERVAL_MAX = 3000; // Max 3 seconds between polls
const TTS_JOB_TIMEOUT = 120000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY = 1000;
const RETRY_MAX_DELAY = 10000;
const BATCH_SIZE = 25; // Process jobs in batches to avoid RunPod queue saturation

const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "eitsgz3gndkh3s";
const RUNPOD_API_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

// Helper function to safely get Supabase credentials
function getSupabaseCredentials(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Supabase credentials not configured');
    return null;
  }

  return { url, key };
}

// SSRF protection: Validate that URL is from trusted Supabase storage
function validateVoiceSampleUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'https:') {
      return { valid: false, error: 'Voice sample URL must use HTTPS protocol' };
    }

    const allowedDomains = ['supabase.co', 'supabase.com'];
    const hostname = parsedUrl.hostname;
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      return { valid: false, error: 'Voice sample URL must be from Supabase storage' };
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') || hostname === '[::1]') {
      return { valid: false, error: 'Voice sample URL cannot point to internal resources' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid voice sample URL format' };
  }
}

// Hard validation - reject early if text is unsafe
function validateTTSInput(text: string): boolean {
  if (!text) return false;
  if (text.trim().length < MIN_TEXT_LENGTH) return false;
  if (text.length > MAX_TEXT_LENGTH) return false;
  if (/[^\x00-\x7F]/.test(text)) return false;
  if (!/[a-zA-Z0-9]/.test(text)) return false;
  return true;
}

// Mandatory normalization before sending to API
function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Split text into safe chunks at sentence boundaries
function splitIntoChunks(text: string, maxLength: number = MAX_TTS_CHUNK_LENGTH): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      const parts = sentence.split(/,\s*/);
      let partChunk = "";
      for (const part of parts) {
        if (part.length > maxLength) {
          if (partChunk) {
            chunks.push(partChunk.trim());
            partChunk = "";
          }
          for (let i = 0; i < part.length; i += maxLength) {
            chunks.push(part.slice(i, i + maxLength).trim());
          }
        } else if ((partChunk + ", " + part).length > maxLength) {
          if (partChunk) chunks.push(partChunk.trim());
          partChunk = part;
        } else {
          partChunk = partChunk ? partChunk + ", " + part : part;
        }
      }
      if (partChunk) chunks.push(partChunk.trim());
    } else if ((currentChunk + " " + sentence).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

// Download voice sample and convert to base64
async function downloadVoiceSample(url: string): Promise<string> {
  logger.debug(`Downloading voice sample from: ${url}`);

  const validation = validateVoiceSampleUrl(url);
  if (!validation.valid) {
    throw new Error(`Security error: ${validation.error}`);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download voice sample: HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    logger.debug(`Voice sample content-type: ${contentType}`);

    if (contentType && !contentType.includes('audio')) {
      logger.warn(`Unexpected content-type: ${contentType}. Expected audio/* type.`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length === 0) {
      throw new Error('Voice sample is empty (0 bytes)');
    }

    if (bytes.length > MAX_VOICE_SAMPLE_SIZE) {
      throw new Error(`Voice sample too large: ${bytes.length} bytes (max ${MAX_VOICE_SAMPLE_SIZE / 1024 / 1024}MB)`);
    }

    const header = Buffer.from(bytes.subarray(0, 4)).toString('ascii');
    if (header === 'RIFF' || header.startsWith('ID3') || header.startsWith('\xFF\xFB')) {
      console.log(`Voice sample format detected: ${header === 'RIFF' ? 'WAV' : header.startsWith('ID3') ? 'MP3' : 'MP3'}`);
    } else {
      console.warn(`Unknown audio format. First 4 bytes: ${Array.from(bytes.subarray(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }

    const base64 = Buffer.from(bytes).toString('base64');

    console.log(`Voice sample downloaded successfully:`);
    console.log(`  - Size: ${bytes.length} bytes (${(bytes.length / 1024).toFixed(2)} KB)`);
    console.log(`  - Base64 length: ${base64.length} chars`);
    console.log(`  - URL: ${url.substring(0, 100)}...`);

    return base64;
  } catch (error) {
    console.error('Error downloading voice sample:', error);
    throw new Error(`Voice sample download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Start TTS job
async function startTTSJob(text: string, apiKey: string, referenceAudioBase64?: string): Promise<string> {
  console.log(`\n=== Starting TTS Job ===`);
  console.log(`Endpoint: ${RUNPOD_API_URL}/run`);
  console.log(`Text length: ${text.length} chars`);
  console.log(`Text preview: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

  if (referenceAudioBase64) {
    console.log(`Voice Cloning: ENABLED`);
    console.log(`Reference audio base64 length: ${referenceAudioBase64.length} chars`);
    console.log(`Reference audio size estimate: ${(referenceAudioBase64.length * 0.75 / 1024).toFixed(2)} KB`);
    console.log(`Base64 preview: ${referenceAudioBase64.substring(0, 50)}...`);
  } else {
    console.log(`Voice Cloning: DISABLED (using default voice)`);
  }

  const inputPayload: Record<string, unknown> = {
    text: text,
    prompt: text,
  };

  if (referenceAudioBase64) {
    inputPayload.reference_audio_base64 = referenceAudioBase64;
    console.log(`Added reference_audio_base64 to payload`);
  }

  console.log(`Payload keys: ${Object.keys(inputPayload).join(', ')}`);

  try {
    const response = await fetch(`${RUNPOD_API_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: inputPayload,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`RunPod API error: ${response.status} ${response.statusText}`);
      console.error(`Error response: ${errorText}`);
      throw new Error(`Failed to start TTS job: HTTP ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const result = await response.json() as any;
    console.log(`TTS job created successfully`);
    console.log(`Job ID: ${result.id}`);
    console.log(`Job status: ${result.status || 'N/A'}`);

    if (!result.id) {
      throw new Error('No job ID returned from RunPod');
    }

    console.log(`=== TTS Job Started ===\n`);
    return result.id;
  } catch (error) {
    console.error('Failed to start TTS job:', error);
    throw error;
  }
}

// Poll job status with adaptive polling (starts fast, slows down)
async function pollJobStatus(jobId: string, apiKey: string): Promise<{ audio_base64: string; sample_rate: number }> {
  const maxAttempts = 120;
  let pollInterval = TTS_JOB_POLL_INTERVAL_INITIAL; // Start at 500ms

  console.log(`\n=== Polling Job Status ===`);
  console.log(`Job ID: ${jobId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt % 5 === 0 || attempt < 3) {
      console.log(`Polling attempt ${attempt + 1}/${maxAttempts} (interval: ${pollInterval}ms)...`);
    }

    const response = await fetch(`${RUNPOD_API_URL}/status/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to poll job status: HTTP ${response.status}`);
      console.error(`Error response: ${errorText}`);
      throw new Error(`Failed to poll job status: ${response.status}`);
    }

    const result = await response.json() as any;
    console.log(`Job status: ${result.status}`);

    if (result.status === 'COMPLETED') {
      console.log(`Job completed successfully!`);
      if (!result.output?.audio_base64) {
        console.error('Missing audio_base64 in output:', result.output);
        throw new Error('No audio_base64 in completed job output');
      }
      console.log(`Audio output received: ${result.output.audio_base64.length} chars base64`);
      console.log(`Sample rate: ${result.output.sample_rate || 'N/A'}`);
      console.log(`=== Job Completed ===\n`);
      return result.output;
    }

    if (result.status === 'FAILED') {
      console.error(`\n!!! TTS Job FAILED !!!`);
      console.error(`Job ID: ${jobId}`);
      console.error(`Error: ${result.error || 'Unknown error'}`);
      console.error(`Full result:`, JSON.stringify(result, null, 2));
      throw new Error(`TTS job failed: ${result.error || 'Unknown error'}`);
    }

    if (result.delayTime) {
      console.log(`Estimated delay: ${result.delayTime}ms`);
    }

    // Adaptive polling: increase interval after first 5 attempts
    if (attempt >= 5) {
      pollInterval = Math.min(pollInterval * 1.2, TTS_JOB_POLL_INTERVAL_MAX);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.error(`\n!!! Job Timeout !!!`);
  console.error(`Job ID: ${jobId} timed out after max attempts`);
  throw new Error('TTS job timed out after 2 minutes');
}

// Convert base64 to buffer
function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

// Concatenate multiple WAV files
function concatenateWavFiles(audioChunks: Buffer[]): { wav: Buffer; durationSeconds: number } {
  if (audioChunks.length === 0) {
    throw new Error('No audio chunks to concatenate');
  }

  const findChunk = (bytes: Buffer, fourcc: string) => {
    const needle = Buffer.from(fourcc, 'ascii');
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (bytes.slice(i, i + 4).equals(needle)) {
        return i;
      }
    }
    return -1;
  };

  const extract = (wav: Buffer) => {
    if (wav.length < 16) throw new Error('WAV chunk too small');

    const riff = wav.slice(0, 4).toString('ascii');
    const wave = wav.slice(8, 12).toString('ascii');
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      console.warn('Unexpected WAV header (not RIFF/WAVE); attempting to parse anyway');
    }

    const fmtIdx = findChunk(wav, 'fmt ');
    const dataIdx = findChunk(wav, 'data');
    if (fmtIdx === -1) throw new Error('Missing fmt chunk in WAV');
    if (dataIdx === -1) throw new Error('Missing data chunk in WAV');

    const fmtDataStart = fmtIdx + 8;
    const audioFormat = wav.readUInt16LE(fmtDataStart + 0);
    const channels = wav.readUInt16LE(fmtDataStart + 2);
    const sampleRate = wav.readUInt32LE(fmtDataStart + 4);
    const byteRate = wav.readUInt32LE(fmtDataStart + 8);
    const bitsPerSample = wav.readUInt16LE(fmtDataStart + 14);

    if (audioFormat !== 1) {
      console.warn(`Non-PCM WAV detected (audioFormat=${audioFormat}). Browser playback may fail.`);
    }

    const dataSizeOffset = dataIdx + 4;
    const dataSize = wav.readUInt32LE(dataSizeOffset);
    const dataStart = dataIdx + 8;
    const dataEnd = Math.min(wav.length, dataStart + dataSize);

    const header = wav.slice(0, dataStart);
    const data = wav.slice(dataStart, dataEnd);

    return { header, data, dataIdx, dataSizeOffset, sampleRate, channels, bitsPerSample, byteRate };
  };

  const first = extract(audioChunks[0]);
  const extracted = audioChunks.map(extract);
  const totalDataSize = extracted.reduce((sum, e) => sum + e.data.length, 0);

  const output = Buffer.alloc(first.header.length + totalDataSize);
  first.header.copy(output, 0);

  output.writeUInt32LE(output.length - 8, 4);
  output.writeUInt32LE(totalDataSize, first.dataSizeOffset);

  let offset = first.header.length;
  for (const e of extracted) {
    e.data.copy(output, offset);
    offset += e.data.length;
  }

  const safeByteRate = first.byteRate || (first.sampleRate * first.channels * (first.bitsPerSample / 8));
  const durationSeconds = safeByteRate > 0 ? totalDataSize / safeByteRate : 0;

  return { wav: output, durationSeconds };
}

// Convert WAV buffer to MP3 to reduce file size (90% smaller)
function convertWavToMp3(wavBuffer: Buffer): Buffer {
  logger.debug('Converting WAV to MP3...');

  // Extract WAV header info
  const findChunk = (bytes: Buffer, fourcc: string) => {
    const needle = Buffer.from(fourcc, 'ascii');
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (bytes.slice(i, i + 4).equals(needle)) {
        return i;
      }
    }
    return -1;
  };

  const fmtIdx = findChunk(wavBuffer, 'fmt ');
  const dataIdx = findChunk(wavBuffer, 'data');

  if (fmtIdx === -1 || dataIdx === -1) {
    throw new Error('Invalid WAV file: missing fmt or data chunk');
  }

  const fmtDataStart = fmtIdx + 8;
  const channels = wavBuffer.readUInt16LE(fmtDataStart + 2);
  const sampleRate = wavBuffer.readUInt32LE(fmtDataStart + 4);
  const bitsPerSample = wavBuffer.readUInt16LE(fmtDataStart + 14);

  const dataSizeOffset = dataIdx + 4;
  const dataSize = wavBuffer.readUInt32LE(dataSizeOffset);
  const dataStart = dataIdx + 8;

  // Extract PCM samples
  const samples = wavBuffer.slice(dataStart, dataStart + dataSize);

  logger.debug(`WAV info: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${samples.length} bytes`);

  // Convert to 16-bit PCM samples array
  const samplesPerChannel = samples.length / (channels * 2); // 2 bytes per sample (16-bit)
  const leftChannel = new Int16Array(samplesPerChannel);
  const rightChannel = channels === 2 ? new Int16Array(samplesPerChannel) : null;

  for (let i = 0; i < samplesPerChannel; i++) {
    const offset = i * channels * 2;
    leftChannel[i] = samples.readInt16LE(offset);
    if (rightChannel && channels === 2) {
      rightChannel[i] = samples.readInt16LE(offset + 2);
    }
  }

  // Encode to MP3
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128 kbps
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152; // LAME samples per frame

  for (let i = 0; i < samplesPerChannel; i += sampleBlockSize) {
    const leftChunk = leftChannel.subarray(i, i + sampleBlockSize);
    const rightChunk = rightChannel ? rightChannel.subarray(i, i + sampleBlockSize) : null;

    const mp3buf = rightChunk
      ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
      : mp3encoder.encodeBuffer(leftChunk);

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  // Flush remaining data
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  // Concatenate all MP3 chunks
  const totalLength = mp3Data.reduce((acc, chunk) => acc + chunk.length, 0);
  const mp3Buffer = Buffer.alloc(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    mp3Buffer.set(chunk, offset);
    offset += chunk.length;
  }

  const compressionRatio = ((1 - mp3Buffer.length / wavBuffer.length) * 100).toFixed(1);
  logger.info(`WAV to MP3 conversion: ${wavBuffer.length} bytes → ${mp3Buffer.length} bytes (${compressionRatio}% smaller)`);

  return mp3Buffer;
}

// Main route handler
router.post('/', async (req: Request, res: Response) => {
  try {
    const { script, voiceSampleUrl, projectId, stream } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'Script is required' });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    if (!RUNPOD_API_KEY) {
      return res.status(500).json({ error: 'RUNPOD_API_KEY not configured' });
    }

    // Clean script
    let cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    cleanScript = normalizeText(cleanScript);

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    logger.info(`Generating audio for ${wordCount} words with Chatterbox TTS...`);
    logger.debug(`Normalized text length: ${cleanScript.length} chars`);

    const rawChunks = splitIntoChunks(cleanScript, MAX_TTS_CHUNK_LENGTH);
    logger.debug(`Split into ${rawChunks.length} chunks`);

    const chunks: string[] = [];
    for (let i = 0; i < rawChunks.length; i++) {
      if (!validateTTSInput(rawChunks[i])) {
        logger.warn(`Skipping chunk ${i + 1} (invalid): "${rawChunks[i].substring(0, 50)}..."`);
        continue;
      }
      chunks.push(rawChunks[i]);
    }

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No valid text chunks after validation. Script may contain only special characters or be too short.' });
    }

    logger.info(`Using ${chunks.length} valid chunks (skipped ${rawChunks.length - chunks.length} invalid)`);

    // Voice cloning support
    if (voiceSampleUrl && stream) {
      logger.info('Using streaming mode with voice cloning');
      return handleVoiceCloningStreaming(req, res, chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
    }

    if (stream) {
      return handleStreaming(req, res, chunks, projectId, wordCount, RUNPOD_API_KEY);
    } else {
      return handleNonStreaming(req, res, chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
    }

  } catch (error) {
    logger.error('Error generating audio:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Audio generation failed'
    });
  }
});

// Handle streaming without voice cloning (PARALLEL OPTIMIZED - 5-10x faster!)
async function handleStreaming(req: Request, res: Response, chunks: string[], projectId: string, wordCount: number, apiKey: string) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: 'progress', progress: 5, message: `Starting Chatterbox TTS (${chunks.length} chunks, default voice)...` });

    // OPTIMIZATION: Process jobs in BATCHES to avoid RunPod queue saturation
    const totalChunks = chunks.length;
    const numBatches = Math.ceil(totalChunks / BATCH_SIZE);
    console.log(`\n=== Processing ${totalChunks} chunks in ${numBatches} batches of ${BATCH_SIZE} (no voice cloning) ===`);
    sendEvent({ type: 'progress', progress: 10, message: `Processing ${totalChunks} chunks in ${numBatches} batches...` });

    const allAudioResults: { index: number; audioData: Buffer | null; error: string | null }[] = [];
    let totalCompleted = 0;

    // Process chunks in batches
    for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
      const batchChunks = chunks.slice(batchStart, batchEnd);
      const batchSize = batchChunks.length;

      console.log(`\n--- Batch ${batchIndex + 1}/${numBatches}: Processing chunks ${batchStart + 1}-${batchEnd} (${batchSize} chunks) ---`);

      // Step 1: Create jobs for this batch in parallel
      const jobPromises = batchChunks.map(async (chunkText, batchLocalIndex) => {
        const globalIndex = batchStart + batchLocalIndex;
        try {
          const jobId = await startTTSJob(chunkText, apiKey);
          console.log(`Batch ${batchIndex + 1}: Job ${globalIndex + 1}/${totalChunks} created: ${jobId}`);
          return { jobId, index: globalIndex, error: null };
        } catch (err) {
          console.error(`Batch ${batchIndex + 1}: Failed to create job ${globalIndex + 1}:`, err);
          return { jobId: null, index: globalIndex, error: err instanceof Error ? err.message : 'Job creation failed' };
        }
      });

      const jobResults = await Promise.all(jobPromises);
      const validJobs = jobResults.filter(r => r.jobId !== null);

      if (validJobs.length === 0) {
        console.warn(`Batch ${batchIndex + 1}: All jobs failed to create, skipping batch`);
        continue;
      }

      console.log(`Batch ${batchIndex + 1}: Created ${validJobs.length}/${batchSize} jobs successfully`);

      // Step 2: Poll jobs for this batch in parallel
      const pollPromises = validJobs.map(async ({ jobId, index }) => {
        try {
          const output = await pollJobStatus(jobId!, apiKey);
          const audioData = base64ToBuffer(output.audio_base64);
          console.log(`Batch ${batchIndex + 1}: Job ${index + 1}/${totalChunks} completed: ${audioData.length} bytes`);

          // Update progress
          totalCompleted++;
          const progress = 10 + Math.round((totalCompleted / totalChunks) * 65);
          sendEvent({ type: 'progress', progress, message: `Generated ${totalCompleted}/${totalChunks} chunks (batch ${batchIndex + 1}/${numBatches})...` });

          return { index, audioData, error: null };
        } catch (err) {
          console.error(`Batch ${batchIndex + 1}: Failed to poll job ${index + 1}:`, err);
          return { index, audioData: null, error: err instanceof Error ? err.message : 'Polling failed' };
        }
      });

      const batchResults = await Promise.all(pollPromises);
      allAudioResults.push(...batchResults);

      console.log(`Batch ${batchIndex + 1}/${numBatches} complete: ${batchResults.filter(r => r.audioData !== null).length}/${batchSize} successful`);
    }

    // Sort all results by index to maintain correct order
    allAudioResults.sort((a, b) => a.index - b.index);

    // Extract audio chunks (skip failed ones)
    const audioChunks = allAudioResults
      .filter(r => r.audioData !== null)
      .map(r => r.audioData!);

    const failedCount = allAudioResults.filter(r => r.audioData === null).length;
    if (failedCount > 0) {
      console.warn(`Warning: ${failedCount}/${totalChunks} chunks failed during processing`);
    }

    if (audioChunks.length === 0) {
      throw new Error('All audio chunks failed to generate');
    }

    console.log(`Successfully generated ${audioChunks.length}/${totalChunks} audio chunks`);

    sendEvent({ type: 'progress', progress: 75, message: 'Concatenating audio chunks...' });

    const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
    const durationRounded = Math.round(durationSeconds);

    console.log(`Final audio WAV: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

    sendEvent({ type: 'progress', progress: 85, message: 'Converting to MP3...' });
    const mp3Audio = convertWavToMp3(finalAudio);
    console.log(`Final audio MP3: ${mp3Audio.length} bytes (${((1 - mp3Audio.length / finalAudio.length) * 100).toFixed(1)}% smaller)`);

    sendEvent({ type: 'progress', progress: 90, message: 'Uploading audio file...' });

    const credentials = getSupabaseCredentials();
    if (!credentials) {
      sendEvent({ type: 'error', error: 'Supabase credentials not configured' });
      res.end();
      return;
    }

    const supabase = createClient(credentials.url, credentials.key);
    const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, mp3Audio, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      const errorMsg = `Failed to upload audio: ${uploadError.message || JSON.stringify(uploadError)}`;
      sendEvent({ type: 'error', error: errorMsg });
      res.end();
      return;
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    console.log('Audio uploaded:', urlData.publicUrl);

    sendEvent({ type: 'complete', audioUrl: urlData.publicUrl, duration: durationRounded, size: mp3Audio.length });
    res.end();

  } catch (error) {
    console.error('Audio error:', error);
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Audio generation failed' });
    res.end();
  }
}

// Handle streaming with voice cloning (PARALLEL OPTIMIZED - 5-10x faster!)
async function handleVoiceCloningStreaming(req: Request, res: Response, chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl: string) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: 'progress', progress: 5, message: `Starting voice cloning (${chunks.length} chunks)...` });

    sendEvent({ type: 'progress', progress: 10, message: 'Downloading voice sample...' });

    const referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);

    // OPTIMIZATION: Process jobs in BATCHES to avoid RunPod queue saturation
    const totalChunks = chunks.length;
    const numBatches = Math.ceil(totalChunks / BATCH_SIZE);
    console.log(`\n=== Processing ${totalChunks} chunks in ${numBatches} batches of ${BATCH_SIZE} ===`);
    sendEvent({ type: 'progress', progress: 15, message: `Processing ${totalChunks} chunks in ${numBatches} batches...` });

    const allAudioResults: { index: number; audioData: Buffer | null; error: string | null }[] = [];
    let totalCompleted = 0;

    // Process chunks in batches
    for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
      const batchChunks = chunks.slice(batchStart, batchEnd);
      const batchSize = batchChunks.length;

      console.log(`\n--- Batch ${batchIndex + 1}/${numBatches}: Processing chunks ${batchStart + 1}-${batchEnd} (${batchSize} chunks) ---`);

      // Step 1: Create jobs for this batch in parallel
      const jobPromises = batchChunks.map(async (chunkText, batchLocalIndex) => {
        const globalIndex = batchStart + batchLocalIndex;
        try {
          const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
          console.log(`Batch ${batchIndex + 1}: Job ${globalIndex + 1}/${totalChunks} created: ${jobId}`);
          return { jobId, index: globalIndex, error: null };
        } catch (err) {
          console.error(`Batch ${batchIndex + 1}: Failed to create job ${globalIndex + 1}:`, err);
          return { jobId: null, index: globalIndex, error: err instanceof Error ? err.message : 'Job creation failed' };
        }
      });

      const jobResults = await Promise.all(jobPromises);
      const validJobs = jobResults.filter(r => r.jobId !== null);

      if (validJobs.length === 0) {
        console.warn(`Batch ${batchIndex + 1}: All jobs failed to create, skipping batch`);
        continue;
      }

      console.log(`Batch ${batchIndex + 1}: Created ${validJobs.length}/${batchSize} jobs successfully`);

      // Step 2: Poll jobs for this batch in parallel
      const pollPromises = validJobs.map(async ({ jobId, index }) => {
        try {
          const output = await pollJobStatus(jobId!, apiKey);
          const audioData = base64ToBuffer(output.audio_base64);
          console.log(`Batch ${batchIndex + 1}: Job ${index + 1}/${totalChunks} completed: ${audioData.length} bytes`);

          // Update progress
          totalCompleted++;
          const progress = 15 + Math.round((totalCompleted / totalChunks) * 60);
          sendEvent({ type: 'progress', progress, message: `Generated ${totalCompleted}/${totalChunks} chunks (batch ${batchIndex + 1}/${numBatches})...` });

          return { index, audioData, error: null };
        } catch (err) {
          console.error(`Batch ${batchIndex + 1}: Failed to poll job ${index + 1}:`, err);
          return { index, audioData: null, error: err instanceof Error ? err.message : 'Polling failed' };
        }
      });

      const batchResults = await Promise.all(pollPromises);
      allAudioResults.push(...batchResults);

      console.log(`Batch ${batchIndex + 1}/${numBatches} complete: ${batchResults.filter(r => r.audioData !== null).length}/${batchSize} successful`);
    }

    // Sort all results by index to maintain correct order
    allAudioResults.sort((a, b) => a.index - b.index);

    // Extract audio chunks (skip failed ones)
    const audioChunks = allAudioResults
      .filter(r => r.audioData !== null)
      .map(r => r.audioData!);

    const failedCount = allAudioResults.filter(r => r.audioData === null).length;
    if (failedCount > 0) {
      console.warn(`Warning: ${failedCount}/${totalChunks} chunks failed during processing`);
    }

    if (audioChunks.length === 0) {
      throw new Error('All audio chunks failed to generate');
    }

    console.log(`Successfully generated ${audioChunks.length}/${totalChunks} audio chunks`);

    sendEvent({ type: 'progress', progress: 80, message: 'Concatenating audio chunks...' });

    const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
    const durationRounded = Math.round(durationSeconds);

    console.log(`Final audio WAV: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

    sendEvent({ type: 'progress', progress: 90, message: 'Converting to MP3...' });
    const mp3Audio = convertWavToMp3(finalAudio);
    console.log(`Final audio MP3: ${mp3Audio.length} bytes (${((1 - mp3Audio.length / finalAudio.length) * 100).toFixed(1)}% smaller)`);

    sendEvent({ type: 'progress', progress: 95, message: 'Uploading audio...' });

    const credentials = getSupabaseCredentials();
    if (!credentials) {
      sendEvent({ type: 'error', error: 'Supabase credentials not configured' });
      res.end();
      return;
    }

    const supabase = createClient(credentials.url, credentials.key);
    const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, mp3Audio, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Failed to upload audio: ${uploadError.message || JSON.stringify(uploadError)}`);
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    sendEvent({ type: 'complete', success: true, audioUrl: urlData.publicUrl, duration: durationRounded, wordCount, size: mp3Audio.length });
    res.end();

  } catch (error) {
    console.error('Audio error:', error);
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Audio generation failed' });
    res.end();
  }
}

// Handle non-streaming (with or without voice cloning) - PARALLEL OPTIMIZED
async function handleNonStreaming(req: Request, res: Response, chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl?: string) {
  let referenceAudioBase64: string | undefined;
  if (voiceSampleUrl) {
    console.log('Downloading voice sample for cloning...');
    referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);
  }

  // OPTIMIZATION: Process jobs in BATCHES to avoid RunPod queue saturation
  const totalChunks = chunks.length;
  const numBatches = Math.ceil(totalChunks / BATCH_SIZE);
  console.log(`\n=== Processing ${totalChunks} chunks in ${numBatches} batches of ${BATCH_SIZE} ===`);

  const allAudioResults: { index: number; audioData: Buffer | null; error: string | null }[] = [];

  // Process chunks in batches
  for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
    const batchChunks = chunks.slice(batchStart, batchEnd);
    const batchSize = batchChunks.length;

    console.log(`\n--- Batch ${batchIndex + 1}/${numBatches}: Processing chunks ${batchStart + 1}-${batchEnd} (${batchSize} chunks) ---`);

    // Step 1: Create jobs for this batch in parallel
    const jobPromises = batchChunks.map(async (chunkText, batchLocalIndex) => {
      const globalIndex = batchStart + batchLocalIndex;
      try {
        const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
        console.log(`Batch ${batchIndex + 1}: Job ${globalIndex + 1}/${totalChunks} created: ${jobId}`);
        return { jobId, index: globalIndex, error: null };
      } catch (err) {
        console.error(`Batch ${batchIndex + 1}: Failed to create job ${globalIndex + 1}:`, err);
        return { jobId: null, index: globalIndex, error: err instanceof Error ? err.message : 'Job creation failed' };
      }
    });

    const jobResults = await Promise.all(jobPromises);
    const validJobs = jobResults.filter(r => r.jobId !== null);

    if (validJobs.length === 0) {
      console.warn(`Batch ${batchIndex + 1}: All jobs failed to create, skipping batch`);
      continue;
    }

    console.log(`Batch ${batchIndex + 1}: Created ${validJobs.length}/${batchSize} jobs successfully`);

    // Step 2: Poll jobs for this batch in parallel
    const pollPromises = validJobs.map(async ({ jobId, index }) => {
      try {
        const output = await pollJobStatus(jobId!, apiKey);
        const audioData = base64ToBuffer(output.audio_base64);
        console.log(`Batch ${batchIndex + 1}: Job ${index + 1}/${totalChunks} completed: ${audioData.length} bytes`);
        return { index, audioData, error: null };
      } catch (err) {
        console.error(`Batch ${batchIndex + 1}: Failed to poll job ${index + 1}:`, err);
        return { index, audioData: null, error: err instanceof Error ? err.message : 'Polling failed' };
      }
    });

    const batchResults = await Promise.all(pollPromises);
    allAudioResults.push(...batchResults);

    console.log(`Batch ${batchIndex + 1}/${numBatches} complete: ${batchResults.filter(r => r.audioData !== null).length}/${batchSize} successful`);
  }

  // Sort all results by index to maintain correct order
  allAudioResults.sort((a, b) => a.index - b.index);

  // Extract audio chunks (skip failed ones)
  const audioChunks = allAudioResults
    .filter(r => r.audioData !== null)
    .map(r => r.audioData!);

  const failedCount = allAudioResults.filter(r => r.audioData === null).length;
  if (failedCount > 0) {
    console.warn(`Warning: ${failedCount}/${totalChunks} chunks failed during processing`);
  }

  if (audioChunks.length === 0) {
    return res.status(500).json({ success: false, error: 'All audio chunks failed to generate' });
  }

  console.log(`Successfully generated ${audioChunks.length}/${totalChunks} audio chunks`);

  const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
  const durationRounded = Math.round(durationSeconds);

  console.log(`Final audio WAV: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

  const mp3Audio = convertWavToMp3(finalAudio);
  console.log(`Final audio MP3: ${mp3Audio.length} bytes (${((1 - mp3Audio.length / finalAudio.length) * 100).toFixed(1)}% smaller)`);

  const credentials = getSupabaseCredentials();
  if (!credentials) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const supabase = createClient(credentials.url, credentials.key);
  const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;

  const { error: uploadError } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, mp3Audio, {
      contentType: 'audio/mpeg',
      upsert: true,
    });

  if (uploadError) {
    console.error('Upload error:', uploadError);
    throw new Error(`Failed to upload audio: ${uploadError.message || JSON.stringify(uploadError)}`);
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  return res.json({
    success: true,
    audioUrl: urlData.publicUrl,
    duration: durationRounded,
    wordCount,
    size: mp3Audio.length
  });
}

export default router;
