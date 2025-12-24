import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import FormData from 'form-data';
import fetch from 'node-fetch';

const router = Router();

// WAV file constants
const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const BYTES_PER_SECOND = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;

// Whisper API has 25MB limit, we'll use 20MB chunks to be safe
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;
const MAX_CHUNK_DURATION = Math.floor(MAX_CHUNK_BYTES / BYTES_PER_SECOND); // ~227 seconds

// Format time for SRT (HH:MM:SS,mmm)
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Split segment text into smaller chunks with 5-7 words max, 3 words min per line
function splitSegmentIntoChunks(segment: { text: string; start: number; end: number }): { text: string; start: number; end: number }[] {
  const words = segment.text.split(/\s+/).filter(w => w.length > 0);
  const maxWords = 6; // Target 5-7 words, using 6 as sweet spot
  const minWords = 3;

  // If segment is already within limits, return as-is
  if (words.length <= maxWords && words.length >= minWords) {
    return [segment];
  }

  // If too few words, return as-is (can't split further)
  if (words.length < minWords) {
    return [segment];
  }

  const chunks: { text: string; start: number; end: number }[] = [];
  const totalDuration = segment.end - segment.start;
  const durationPerWord = totalDuration / words.length;

  let i = 0;
  while (i < words.length) {
    const remaining = words.length - i;

    // Determine chunk size: aim for 5-6 words, but ensure last chunk has at least 3
    let chunkSize = maxWords;

    // If remaining words would leave a too-small last chunk, adjust
    if (remaining > maxWords && remaining < maxWords + minWords) {
      // Split evenly to avoid small last chunk
      chunkSize = Math.ceil(remaining / 2);
    } else if (remaining <= maxWords) {
      // Take all remaining
      chunkSize = remaining;
    }

    // Ensure minimum chunk size
    chunkSize = Math.max(chunkSize, Math.min(minWords, remaining));

    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push({
      text: chunkWords.join(' '),
      start: segment.start + (i * durationPerWord),
      end: segment.start + ((i + chunkSize) * durationPerWord),
    });

    i += chunkSize;
  }

  return chunks;
}

// Audio format parameters (will be set from actual WAV file)
interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

// Create a WAV header for a chunk of PCM data with actual audio parameters
function createWavHeader(dataSize: number, format: AudioFormat): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = format;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // "RIFF" chunk descriptor
  view.setUint8(0, 0x52); // R
  view.setUint8(1, 0x49); // I
  view.setUint8(2, 0x46); // F
  view.setUint8(3, 0x46); // F
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  view.setUint8(8, 0x57);  // W
  view.setUint8(9, 0x41);  // A
  view.setUint8(10, 0x56); // V
  view.setUint8(11, 0x45); // E

  // "fmt " sub-chunk
  view.setUint8(12, 0x66); // f
  view.setUint8(13, 0x6d); // m
  view.setUint8(14, 0x74); // t
  view.setUint8(15, 0x20); // (space)
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  view.setUint8(36, 0x64); // d
  view.setUint8(37, 0x61); // a
  view.setUint8(38, 0x74); // t
  view.setUint8(39, 0x61); // a
  view.setUint32(40, dataSize, true);

  return new Uint8Array(header);
}

// Find a chunk in WAV data by its fourcc identifier
function findWavChunk(wavData: Uint8Array, fourcc: string): number {
  const needle = new TextEncoder().encode(fourcc);
  for (let i = 0; i <= wavData.length - 4; i++) {
    if (wavData[i] === needle[0] && wavData[i+1] === needle[1] &&
        wavData[i+2] === needle[2] && wavData[i+3] === needle[3]) {
      return i;
    }
  }
  return -1;
}

// Extract PCM data from WAV file by finding the actual 'data' chunk
function extractPcmFromWav(wavData: Uint8Array): { pcmData: Uint8Array; sampleRate: number; channels: number; bitsPerSample: number } {
  // Find fmt chunk to get audio parameters
  const fmtIdx = findWavChunk(wavData, 'fmt ');
  if (fmtIdx === -1) {
    console.warn('No fmt chunk found, using defaults');
    // Fallback to old behavior
    return {
      pcmData: wavData.slice(44),
      sampleRate: SAMPLE_RATE,
      channels: NUM_CHANNELS,
      bitsPerSample: BITS_PER_SAMPLE
    };
  }

  // Parse fmt chunk (starts 8 bytes after 'fmt ')
  const fmtDataStart = fmtIdx + 8;
  const view = new DataView(wavData.buffer, wavData.byteOffset, wavData.byteLength);
  const channels = view.getUint16(fmtDataStart + 2, true);
  const sampleRate = view.getUint32(fmtDataStart + 4, true);
  const bitsPerSample = view.getUint16(fmtDataStart + 14, true);

  // Find data chunk
  const dataIdx = findWavChunk(wavData, 'data');
  if (dataIdx === -1) {
    console.warn('No data chunk found, using offset 44');
    return {
      pcmData: wavData.slice(44),
      sampleRate,
      channels,
      bitsPerSample
    };
  }

  // Read data chunk size and extract PCM
  const dataSize = view.getUint32(dataIdx + 4, true);
  const dataStart = dataIdx + 8;
  const dataEnd = Math.min(wavData.length, dataStart + dataSize);

  console.log(`WAV parsing: fmt@${fmtIdx}, data@${dataIdx}, dataSize=${dataSize}, actual=${dataEnd - dataStart}`);
  console.log(`WAV format: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit`);

  return {
    pcmData: wavData.slice(dataStart, dataEnd),
    sampleRate,
    channels,
    bitsPerSample
  };
}

// Create a WAV file from PCM data with correct format
function createWavFromPcm(pcmData: Uint8Array, format: AudioFormat): Uint8Array {
  const header = createWavHeader(pcmData.length, format);
  const wavData = new Uint8Array(header.length + pcmData.length);
  wavData.set(header, 0);
  wavData.set(pcmData, header.length);
  return wavData;
}

// Transcribe a single audio chunk with retry logic (using Groq Whisper)
async function transcribeChunk(audioData: Uint8Array, groqApiKey: string, chunkIndex: number): Promise<{ chunkIndex: number; segments: Array<{ text: string; start: number; end: number }>; duration: number }> {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const formData = new FormData();
      formData.append('file', Buffer.from(audioData), { filename: 'audio.wav', contentType: 'audio/wav' });
      formData.append('model', 'whisper-large-v3-turbo'); // Groq's fastest Whisper model
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('language', 'en'); // Speed optimization: skip language detection

      console.log(`Transcribing chunk ${chunkIndex + 1}, size: ${audioData.length} bytes${attempt > 1 ? ` (attempt ${attempt})` : ''}`);

      const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          ...formData.getHeaders(),
        },
        body: formData as any,
      });

      if (!whisperResponse.ok) {
        const errorText = await whisperResponse.text();
        console.error('Groq Whisper API error:', whisperResponse.status, errorText);
        throw new Error(`Groq Whisper API error: ${whisperResponse.status}`);
      }

      const result = await whisperResponse.json() as any;
      console.log(`Chunk ${chunkIndex + 1} transcribed, duration: ${result.duration}s, segments: ${result.segments?.length || 0}`);

      return {
        chunkIndex,
        segments: result.segments || [],
        duration: result.duration || 0,
      };
    } catch (error: any) {
      lastError = error;
      const isRetryable = error.code === 'ECONNRESET' ||
                          error.code === 'ETIMEDOUT' ||
                          error.message?.includes('socket hang up') ||
                          error.message?.includes('network');

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s... max 10s
        console.log(`Chunk ${chunkIndex + 1} failed (${error.code || error.message}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw lastError || new Error('Transcription failed after retries');
}

router.post('/', async (req: Request, res: Response) => {
  const { audioUrl, projectId, stream } = req.body;

  // Keepalive interval for SSE
  let heartbeatInterval: NodeJS.Timeout | null = null;

  // Setup SSE if streaming is enabled
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send keepalive every 15 seconds to prevent connection timeout
    heartbeatInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);
  }

  const sendEvent = (data: any) => {
    if (stream) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Cleanup function to clear heartbeat
  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  try {
    if (!audioUrl) {
      const error = { error: 'Audio URL is required' };
      if (stream) {
        sendEvent({ type: 'error', ...error });
        cleanup();
        return res.end();
      }
      return res.status(400).json(error);
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      const error = { error: 'GROQ_API_KEY is not configured' };
      if (stream) {
        sendEvent({ type: 'error', ...error });
        cleanup();
        return res.end();
      }
      return res.status(500).json(error);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      const error = { error: 'Supabase credentials not configured' };
      if (stream) {
        sendEvent({ type: 'error', ...error });
        cleanup();
        return res.end();
      }
      return res.status(500).json(error);
    }

    console.log('Fetching audio from:', audioUrl);

    // Send downloading progress
    sendEvent({
      type: 'progress',
      progress: 1,
      message: '1%'
    });

    // Download the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
    }

    // Get content length for progress tracking
    const contentLength = audioResponse.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    // Download with progress tracking
    const audioArrayBuffer = await audioResponse.arrayBuffer();
    const audioData = new Uint8Array(audioArrayBuffer);

    // Send download complete message
    sendEvent({
      type: 'progress',
      progress: 2,
      message: '2%'
    });

    console.log('Audio size:', audioData.length, 'bytes');

    sendEvent({
      type: 'progress',
      progress: 3,
      message: '3%'
    });

    // Extract PCM data from WAV with proper parsing
    const { pcmData, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioData);
    const audioFormat: AudioFormat = { sampleRate, channels, bitsPerSample };
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    const totalDuration = pcmData.length / bytesPerSecond;
    console.log('Total audio duration:', totalDuration.toFixed(2), 's');

    // Calculate chunk size in bytes using actual audio parameters
    const maxChunkDuration = Math.floor(MAX_CHUNK_BYTES / bytesPerSecond);
    const chunkSizeBytes = maxChunkDuration * bytesPerSecond;
    const numChunks = Math.ceil(pcmData.length / chunkSizeBytes);
    console.log(`Splitting into ${numChunks} chunks of ~${maxChunkDuration}s each`);

    // Process each chunk and collect segments
    const allSegments: Array<{ text: string; start: number; end: number }> = [];

    // Send initial progress
    sendEvent({
      type: 'progress',
      progress: 5,
      message: '5%'
    });
    console.log(`Starting transcription: ${numChunks} chunks`);

    // Prepare all chunks upfront
    const preparedChunks: { chunkIndex: number; wavData: Uint8Array; expectedDuration: number }[] = [];
    for (let i = 0; i < numChunks; i++) {
      const startByte = i * chunkSizeBytes;
      const endByte = Math.min((i + 1) * chunkSizeBytes, pcmData.length);
      const chunkPcm = pcmData.slice(startByte, endByte);
      const chunkWav = createWavFromPcm(chunkPcm, audioFormat);
      const expectedDuration = chunkPcm.length / bytesPerSecond;
      preparedChunks.push({ chunkIndex: i, wavData: chunkWav, expectedDuration });
    }

    // Process chunks in parallel (max 3 concurrent to avoid rate limits)
    const MAX_PARALLEL_CHUNKS = 3;
    const chunkResults: { chunkIndex: number; segments: Array<{ text: string; start: number; end: number }>; duration: number }[] = [];
    let completedChunks = 0;

    for (let batchStart = 0; batchStart < preparedChunks.length; batchStart += MAX_PARALLEL_CHUNKS) {
      const batch = preparedChunks.slice(batchStart, batchStart + MAX_PARALLEL_CHUNKS);
      const currentProgress = 5 + Math.round((completedChunks / numChunks) * 85);

      sendEvent({
        type: 'progress',
        progress: currentProgress,
        message: `${currentProgress}%`
      });

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(chunk => transcribeChunk(chunk.wavData, groqApiKey, chunk.chunkIndex))
      );

      chunkResults.push(...batchResults);
      completedChunks += batch.length;

      const newProgress = 5 + Math.round((completedChunks / numChunks) * 85);
      sendEvent({
        type: 'progress',
        progress: newProgress,
        message: `${newProgress}%`
      });
    }

    // Sort results by chunk index and merge with proper time offsets
    chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex);

    let timeOffset = 0;
    for (const result of chunkResults) {
      for (const seg of result.segments) {
        allSegments.push({
          text: seg.text.trim(),
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
        });
      }
      timeOffset += result.duration;
    }

    console.log('Total segments from all chunks:', allSegments.length);

    // Split segments into smaller chunks for captions (5-7 words max, 3 min)
    const allChunks: { text: string; start: number; end: number }[] = [];
    for (const seg of allSegments) {
      const chunks = splitSegmentIntoChunks(seg);
      allChunks.push(...chunks);
    }
    console.log('Generated', allChunks.length, 'caption segments');

    // Generate SRT content
    let srtContent = '';
    allChunks.forEach((segment: { text: string; start: number; end: number }, index: number) => {
      srtContent += `${index + 1}\n`;
      srtContent += `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n`;
      srtContent += `${segment.text}\n\n`;
    });

    // Upload to Supabase Storage
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/captions.srt`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, Buffer.from(srtContent), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      if (stream) {
        sendEvent({ type: 'error', error: 'Failed to upload captions file' });
        cleanup();
        return res.end();
      }
      return res.status(500).json({ error: 'Failed to upload captions file' });
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    console.log('Captions uploaded successfully:', urlData.publicUrl);

    const result = {
      success: true,
      captionsUrl: urlData.publicUrl,
      srtContent,
      segmentCount: allChunks.length,
      audioDuration: totalDuration,
    };

    if (stream) {
      sendEvent({
        type: 'complete',
        ...result
      });
      cleanup();
      res.end();
    } else {
      return res.json(result);
    }

  } catch (error) {
    console.error('Error generating captions:', error);

    if (stream) {
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to generate captions'
      });
      cleanup();
      res.end();
    } else {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate captions' });
    }
  }
});

export default router;
