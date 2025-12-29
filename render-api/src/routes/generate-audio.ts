import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';
import { promisify } from 'util';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Set FFmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const router = Router();

const DEBUG = process.env.DEBUG === 'true';
const logger = {
  debug: (...args: unknown[]) => DEBUG && console.log('[DEBUG]', ...args),
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
};

// TTS Configuration Constants
const MAX_TTS_CHUNK_LENGTH = 250; // Reduced from 500 to prevent repetition buildup within chunks
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 500; // Match chunk length
const MAX_VOICE_SAMPLE_SIZE = 10 * 1024 * 1024;
const TTS_JOB_POLL_INTERVAL_INITIAL = 250; // Fast initial polling (250ms)
const TTS_JOB_POLL_INTERVAL_MAX = 1000; // Max 1 second between polls for faster detection
const TTS_JOB_TIMEOUT = 120000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY = 1000;
const RETRY_MAX_DELAY = 10000;

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

// SSRF protection: Validate that URL is from trusted sources
function validateVoiceSampleUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'https:') {
      return { valid: false, error: 'Voice sample URL must use HTTPS protocol' };
    }

    // Allow Supabase storage and our own Netlify domain
    const allowedDomains = ['supabase.co', 'supabase.com', 'historygenai.netlify.app'];
    const hostname = parsedUrl.hostname;
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      return { valid: false, error: 'Voice sample URL must be from Supabase storage or app domain' };
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

// Convert numbers to words for better TTS pronunciation
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINALS: Record<string, string> = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
  '11th': 'eleventh', '12th': 'twelfth', '13th': 'thirteenth', '14th': 'fourteenth',
  '15th': 'fifteenth', '16th': 'sixteenth', '17th': 'seventeenth', '18th': 'eighteenth',
  '19th': 'nineteenth', '20th': 'twentieth', '21st': 'twenty-first'
};

function numberToWords(n: number): string {
  if (n < 0) return 'negative ' + numberToWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  if (n < 10000) {
    // For years like 1347, say "thirteen forty-seven" not "one thousand..."
    const century = Math.floor(n / 100);
    const remainder = n % 100;
    if (remainder === 0) return numberToWords(century) + ' hundred';
    return numberToWords(century) + ' ' + (remainder < 10 ? 'oh-' + ONES[remainder] : numberToWords(remainder));
  }
  if (n < 1000000) return numberToWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
  return numberToWords(Math.floor(n / 1000000)) + ' million' + (n % 1000000 ? ' ' + numberToWords(n % 1000000) : '');
}

function convertNumbersToWords(text: string): string {
  // Convert ordinals first (1st, 2nd, 3rd, etc.)
  text = text.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (match) => {
    const lower = match.toLowerCase();
    return ORDINALS[lower] || match;
  });

  // Convert "ACT 5" patterns to "Act Five" (case-insensitive, preserve case of ACT)
  text = text.replace(/\b(ACT|Act|act)\s+(\d+)\b/gi, (_, word, num) => {
    const n = parseInt(num, 10);
    const wordForm = numberToWords(n);
    // Capitalize first letter of number word
    const capitalizedWord = wordForm.charAt(0).toUpperCase() + wordForm.slice(1);
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() + ' ' + capitalizedWord;
  });

  // Convert standalone numbers (but not in URLs or technical contexts)
  text = text.replace(/\b(\d{1,7})\b/g, (match) => {
    const n = parseInt(match, 10);
    if (n > 9999999) return match; // Keep very large numbers as-is
    return numberToWords(n);
  });

  return text;
}

// Mandatory normalization before sending to API
function normalizeText(text: string): string {
  let result = text
    .normalize("NFKD")
    // IMPORTANT: Convert smart quotes/dashes BEFORE removing non-ASCII
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");

  // Convert numbers to words for better TTS pronunciation
  result = convertNumbersToWords(result);

  return result
    .replace(/[^\x00-\x7F]/g, "") // Remove remaining non-ASCII AFTER conversions
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// POST-PROCESSING: Detect and remove repeated audio segments
// ============================================================

// Note: FormData, fs, path, os are imported at top of file

interface WhisperSegment {
  text: string;
  start: number;
  end: number;
}

interface RepetitionRange {
  start: number;
  end: number;
  text: string;
}

// Transcribe audio using Groq Whisper to get segments with timestamps
async function transcribeForRepetitionDetection(audioBuffer: Buffer): Promise<WhisperSegment[]> {
  const groqApiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!groqApiKey) {
    logger.warn('No Groq/OpenAI API key for repetition detection, skipping post-processing');
    return [];
  }

  try {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'en');

    logger.info('Transcribing audio for repetition detection...');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        ...formData.getHeaders(),
      },
      body: formData as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Whisper API error: ${response.status} - ${errorText}`);
      return [];
    }

    const result = await response.json() as any;
    logger.info(`Transcription complete: ${result.segments?.length || 0} segments`);
    return result.segments || [];
  } catch (error) {
    logger.error('Transcription for repetition detection failed:', error);
    return [];
  }
}

// Normalize text for comparison (lowercase, remove punctuation)
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect repeated segments in transcription
function detectRepetitions(segments: WhisperSegment[], minWords: number = 4): RepetitionRange[] {
  if (segments.length < 2) return [];

  const repetitions: RepetitionRange[] = [];
  const processedRanges = new Set<string>();

  // Build a list of sentences from segments
  const sentences: { text: string; normalized: string; start: number; end: number }[] = [];

  for (const seg of segments) {
    // Split segment into sentences if it contains multiple
    const sentenceParts = seg.text.split(/(?<=[.!?])\s+/);
    const segDuration = seg.end - seg.start;
    const timePerChar = segDuration / seg.text.length;

    let currentPos = 0;
    for (const part of sentenceParts) {
      if (part.trim().length > 0) {
        const partStart = seg.start + (currentPos * timePerChar);
        const partEnd = partStart + (part.length * timePerChar);
        sentences.push({
          text: part.trim(),
          normalized: normalizeForComparison(part),
          start: partStart,
          end: partEnd,
        });
      }
      currentPos += part.length + 1;
    }
  }

  logger.info(`Analyzing ${sentences.length} sentences for repetitions...`);

  // Look for consecutive repeated sentences
  for (let i = 0; i < sentences.length - 1; i++) {
    const current = sentences[i];
    const words = current.normalized.split(' ').filter(w => w.length > 0);

    // Skip very short segments
    if (words.length < minWords) continue;

    // Check next sentences for repetition
    for (let j = i + 1; j < Math.min(i + 5, sentences.length); j++) {
      const next = sentences[j];

      // Check for exact or near-exact match
      const similarity = calculateSimilarity(current.normalized, next.normalized);

      if (similarity > 0.85) {
        const rangeKey = `${next.start.toFixed(2)}-${next.end.toFixed(2)}`;
        if (!processedRanges.has(rangeKey)) {
          processedRanges.add(rangeKey);
          repetitions.push({
            start: next.start,
            end: next.end,
            text: next.text,
          });
          logger.info(`Found repetition: "${next.text.substring(0, 50)}..." at ${next.start.toFixed(2)}s-${next.end.toFixed(2)}s (similarity: ${(similarity * 100).toFixed(1)}%)`);
        }
      }
    }
  }

  // Also check for repeated phrases within the same segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const normalized = normalizeForComparison(seg.text);
    const words = normalized.split(' ');

    // Look for repeated 4+ word phrases within the segment
    for (let phraseLen = 4; phraseLen <= Math.min(10, Math.floor(words.length / 2)); phraseLen++) {
      for (let start = 0; start <= words.length - phraseLen * 2; start++) {
        const phrase1 = words.slice(start, start + phraseLen).join(' ');

        for (let start2 = start + phraseLen; start2 <= words.length - phraseLen; start2++) {
          const phrase2 = words.slice(start2, start2 + phraseLen).join(' ');

          if (phrase1 === phrase2) {
            // Found repeated phrase - mark the second occurrence for removal
            const segDuration = seg.end - seg.start;
            const wordDuration = segDuration / words.length;
            const repStart = seg.start + (start2 * wordDuration);
            const repEnd = repStart + (phraseLen * wordDuration);

            const rangeKey = `${repStart.toFixed(2)}-${repEnd.toFixed(2)}`;
            if (!processedRanges.has(rangeKey)) {
              processedRanges.add(rangeKey);
              repetitions.push({
                start: repStart,
                end: repEnd,
                text: phrase2,
              });
              logger.info(`Found in-segment repetition: "${phrase2}" at ${repStart.toFixed(2)}s-${repEnd.toFixed(2)}s`);
            }
            break; // Move to next phrase length
          }
        }
      }
    }
  }

  // Sort by start time and merge overlapping ranges
  repetitions.sort((a, b) => a.start - b.start);

  const merged: RepetitionRange[] = [];
  for (const rep of repetitions) {
    if (merged.length === 0) {
      merged.push(rep);
    } else {
      const last = merged[merged.length - 1];
      if (rep.start <= last.end + 0.1) {
        // Merge overlapping ranges
        last.end = Math.max(last.end, rep.end);
        last.text += ' ' + rep.text;
      } else {
        merged.push(rep);
      }
    }
  }

  logger.info(`Detected ${merged.length} repetition ranges to remove`);
  return merged;
}

// Calculate similarity between two strings (Jaccard-like similarity)
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(' '));
  const words2 = new Set(str2.split(' '));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// Remove audio segments using FFmpeg
async function removeAudioSegments(audioBuffer: Buffer, repetitions: RepetitionRange[]): Promise<Buffer> {
  if (repetitions.length === 0) {
    return audioBuffer;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cleanup-'));
  const inputPath = path.join(tempDir, 'input.wav');
  const outputPath = path.join(tempDir, 'output.wav');

  try {
    // Write input buffer to temp file
    fs.writeFileSync(inputPath, audioBuffer);

    // Get audio duration
    const duration = await getAudioDuration(inputPath);
    logger.info(`Audio duration: ${duration.toFixed(2)}s, removing ${repetitions.length} segments`);

    // Build list of segments to KEEP (inverse of repetitions)
    const keepSegments: { start: number; end: number }[] = [];
    let currentStart = 0;

    for (const rep of repetitions) {
      if (rep.start > currentStart + 0.05) {
        keepSegments.push({ start: currentStart, end: rep.start });
      }
      currentStart = rep.end;
    }

    // Add final segment if there's remaining audio
    if (currentStart < duration - 0.05) {
      keepSegments.push({ start: currentStart, end: duration });
    }

    if (keepSegments.length === 0) {
      logger.warn('No segments to keep after repetition removal, returning original');
      return audioBuffer;
    }

    logger.info(`Keeping ${keepSegments.length} segments, total removed: ${repetitions.reduce((sum, r) => sum + (r.end - r.start), 0).toFixed(2)}s`);

    // Build FFmpeg filter to select and concatenate kept segments
    const filterParts: string[] = [];
    const concatInputs: string[] = [];

    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      filterParts.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs.push(`[a${i}]`);
    }

    const filterComplex = filterParts.join(';') + `;${concatInputs.join('')}concat=n=${keepSegments.length}:v=0:a=1[out]`;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .complexFilter(filterComplex)
        .outputOptions(['-map', '[out]'])
        .output(outputPath)
        .on('error', (err) => reject(err))
        .on('end', () => resolve())
        .run();
    });

    const outputBuffer = fs.readFileSync(outputPath);
    logger.info(`Post-processed audio: ${audioBuffer.length} -> ${outputBuffer.length} bytes`);

    return outputBuffer;

  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      fs.rmdirSync(tempDir);
    } catch (e) {
      logger.warn('Failed to cleanup temp files:', e);
    }
  }
}

// Get audio duration using FFmpeg
function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration || 0);
    });
  });
}

// Main post-processing function
async function postProcessAudio(audioBuffer: Buffer): Promise<Buffer> {
  try {
    // Step 1: Transcribe to detect repetitions
    const segments = await transcribeForRepetitionDetection(audioBuffer);
    if (segments.length === 0) {
      logger.info('No transcription available, skipping post-processing');
      return audioBuffer;
    }

    // Step 2: Detect repetitions
    const repetitions = detectRepetitions(segments);
    if (repetitions.length === 0) {
      logger.info('No repetitions detected');
      return audioBuffer;
    }

    // Step 3: Remove repeated segments
    return await removeAudioSegments(audioBuffer, repetitions);
  } catch (error) {
    logger.error('Post-processing failed, returning original audio:', error);
    return audioBuffer;
  }
}

// ============================================================
// END POST-PROCESSING
// ============================================================

// Split script into N equal segments by word count
const DEFAULT_SEGMENT_COUNT = 10; // Match RunPod max workers for audio endpoint

function splitIntoSegments(text: string, segmentCount: number = DEFAULT_SEGMENT_COUNT): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const wordsPerSegment = Math.ceil(words.length / segmentCount);
  const segments: string[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const start = i * wordsPerSegment;
    const end = (i === segmentCount - 1) ? words.length : (i + 1) * wordsPerSegment;
    const segmentWords = words.slice(start, end);
    if (segmentWords.length > 0) {
      segments.push(segmentWords.join(' '));
    }
  }

  return segments;
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
  const payloadSizeKB = referenceAudioBase64
    ? ((referenceAudioBase64.length * 0.75) / 1024).toFixed(2)
    : '0';

  logger.debug(`Starting TTS job (text: ${text.length} chars, voice sample: ${payloadSizeKB}KB)`);

  const inputPayload: Record<string, unknown> = {
    text: text,
  };

  if (referenceAudioBase64) {
    inputPayload.reference_audio_base64 = referenceAudioBase64;
  }

  try {
    const requestBody = JSON.stringify({ input: inputPayload });
    const requestSizeMB = (requestBody.length / 1024 / 1024).toFixed(2);

    if (parseFloat(requestSizeMB) > 50) {
      throw new Error(`Request payload too large: ${requestSizeMB}MB (RunPod limit is ~50MB). Try using a smaller voice sample.`);
    }

    logger.debug(`Sending ${requestSizeMB}MB request to RunPod...`);

    const response = await fetch(`${RUNPOD_API_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`RunPod API error: ${response.status} ${response.statusText}`);
      logger.error(`Error response: ${errorText.substring(0, 500)}`);
      throw new Error(`Failed to start TTS job: HTTP ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const result = await response.json() as any;

    if (!result.id) {
      throw new Error('No job ID returned from RunPod');
    }

    logger.debug(`TTS job created: ${result.id}`);
    return result.id;
  } catch (error) {
    logger.error(`Failed to start TTS job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

// Poll job status with adaptive polling and delayTime optimization
async function pollJobStatus(jobId: string, apiKey: string): Promise<{ audio_base64: string; sample_rate: number }> {
  const maxAttempts = 300; // Increased from 120 to handle slower workers (5 min timeout)
  let pollInterval = TTS_JOB_POLL_INTERVAL_INITIAL;

  logger.debug(`Polling job ${jobId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${RUNPOD_API_URL}/status/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Poll failed: HTTP ${response.status} - ${errorText}`);
      throw new Error(`Failed to poll job status: ${response.status}`);
    }

    const result = await response.json() as any;

    if (result.status === 'COMPLETED') {
      if (!result.output?.audio_base64) {
        logger.error('Missing audio_base64 in output:', result.output);
        throw new Error('No audio_base64 in completed job output');
      }
      logger.debug(`Job ${jobId} completed: ${result.output.audio_base64.length} chars`);
      return result.output;
    }

    if (result.status === 'FAILED') {
      logger.error(`TTS job ${jobId} failed: ${result.error || 'Unknown error'}`);
      throw new Error(`TTS job failed: ${result.error || 'Unknown error'}`);
    }

    // Use delayTime hint from RunPod if available (smarter polling)
    let sleepTime = pollInterval;
    if (result.delayTime && result.delayTime > pollInterval) {
      // Use RunPod's estimate, capped at 1.5 seconds
      sleepTime = Math.min(result.delayTime, 1500);
    }

    // Adaptive polling: gradually increase interval after first 3 attempts
    if (attempt >= 3) {
      pollInterval = Math.min(pollInterval * 1.15, TTS_JOB_POLL_INTERVAL_MAX);
    }

    await new Promise(resolve => setTimeout(resolve, sleepTime));
  }

  logger.error(`Job ${jobId} timed out after ${maxAttempts} attempts`);
  throw new Error('TTS job timed out after 5 minutes');
}

// Retry TTS chunk generation with exponential backoff
async function generateTTSChunkWithRetry(
  chunkText: string,
  apiKey: string,
  referenceAudioBase64: string | undefined,
  chunkIndex: number,
  totalChunks: number
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          RETRY_INITIAL_DELAY * Math.pow(2, attempt - 1),
          RETRY_MAX_DELAY
        );
        logger.info(`Retry attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS} for chunk ${chunkIndex + 1}/${totalChunks} after ${delay}ms delay`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      logger.debug(`Starting TTS job for chunk ${chunkIndex + 1}/${totalChunks} (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS})`);
      const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
      const output = await pollJobStatus(jobId, apiKey);
      const audioData = base64ToBuffer(output.audio_base64);

      if (attempt > 0) {
        logger.info(`✓ Chunk ${chunkIndex + 1}/${totalChunks} succeeded on attempt ${attempt + 1}`);
      }

      return audioData;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`Attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS} failed for chunk ${chunkIndex + 1}/${totalChunks}: ${lastError.message}`);

      // Don't sleep on the last attempt
      if (attempt === RETRY_MAX_ATTEMPTS - 1) {
        break;
      }
    }
  }

  // All retries exhausted
  logger.error(`✗ Chunk ${chunkIndex + 1}/${totalChunks} FAILED after ${RETRY_MAX_ATTEMPTS} attempts: ${lastError?.message}`);
  throw lastError || new Error('TTS chunk generation failed after all retries');
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

// Adjust audio speed using FFmpeg
// speed < 1.0 = slower (longer duration), speed > 1.0 = faster (shorter duration)
async function adjustAudioSpeed(wavBuffer: Buffer, speed: number): Promise<Buffer> {
  // If speed is 1.0, no adjustment needed
  if (speed === 1.0) {
    return wavBuffer;
  }

  // Clamp speed to valid range (0.5-2.0 for atempo)
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));

  logger.info(`Adjusting audio speed: ${clampedSpeed}x`);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    // Create readable stream from buffer
    const inputStream = new Readable();
    inputStream.push(wavBuffer);
    inputStream.push(null);

    // Create output stream
    const outputStream = new PassThrough();

    outputStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    outputStream.on('end', () => {
      const result = Buffer.concat(chunks);
      logger.info(`Speed adjustment complete: ${wavBuffer.length} -> ${result.length} bytes`);
      resolve(result);
    });

    outputStream.on('error', (err) => {
      logger.error('Speed adjustment output error:', err);
      reject(err);
    });

    // Use atempo filter for speed adjustment
    ffmpeg(inputStream)
      .inputFormat('wav')
      .audioFilters(`atempo=${clampedSpeed}`)
      .format('wav')
      .on('error', (err) => {
        logger.error('FFmpeg error:', err);
        reject(err);
      })
      .pipe(outputStream);
  });
}

// Main route handler
router.post('/', async (req: Request, res: Response) => {
  const { script, voiceSampleUrl, projectId, stream, speed = 1.0 } = req.body;

  // Log raw input immediately
  const rawWordCount = script ? script.split(/\s+/).filter(Boolean).length : 0;
  console.log(`\n[AUDIO REQUEST] Raw script: ${script?.length || 0} chars, ${rawWordCount} words, stream=${stream}, speed=${speed}, voiceSampleUrl=${voiceSampleUrl ? 'YES' : 'NO'}`);

  // Helper to send SSE error events when streaming
  const sendStreamError = (error: string) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
    res.end();
  };

  try {
    if (!script) {
      if (stream) {
        return sendStreamError('Script is required');
      }
      return res.status(400).json({ error: 'Script is required' });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    if (!RUNPOD_API_KEY) {
      if (stream) {
        return sendStreamError('RUNPOD_API_KEY not configured');
      }
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
      const errorMsg = 'No valid text chunks after validation. Script may contain only special characters or be too short.';
      if (stream) {
        return sendStreamError(errorMsg);
      }
      return res.status(400).json({ error: errorMsg });
    }

    logger.info(`Using ${chunks.length} valid chunks (skipped ${rawChunks.length - chunks.length} invalid)`);

    // Voice cloning support - now generates 10 separate segments
    if (voiceSampleUrl && stream) {
      logger.info('Using streaming mode with voice cloning (10 segments)');
      return handleVoiceCloningStreaming(req, res, cleanScript, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl, speed);
    }

    if (stream) {
      return handleStreaming(req, res, chunks, projectId, wordCount, RUNPOD_API_KEY, speed);
    } else {
      return handleNonStreaming(req, res, chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl, speed);
    }

  } catch (error) {
    logger.error('Error generating audio:', error);
    const errorMsg = error instanceof Error ? error.message : 'Audio generation failed';

    if (stream) {
      return sendStreamError(errorMsg);
    }
    return res.status(500).json({ error: errorMsg });
  }
});

// Handle streaming without voice cloning (SEQUENTIAL - Memory optimized)
async function handleStreaming(req: Request, res: Response, chunks: string[], projectId: string, wordCount: number, apiKey: string, speed: number = 1.0) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keep connection alive with heartbeat every 15 seconds
  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  try {
    sendEvent({ type: 'progress', progress: 5, message: `Starting Chatterbox TTS (${chunks.length} chunks, default voice)...` });

    console.log(`\n=== Processing ${chunks.length} chunks sequentially (no voice cloning) ===`);
    sendEvent({ type: 'progress', progress: 10, message: `Processing ${chunks.length} chunks...` });

    const audioChunks: Buffer[] = [];

    // Process each chunk sequentially (no voice cloning in streaming mode)
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);

      const progress = 10 + Math.round(((i + 1) / chunks.length) * 65);
      sendEvent({ type: 'progress', progress, message: `Generating audio chunk ${i + 1}/${chunks.length}...` });

      try {
        // Use retry logic with exponential backoff
        const audioData = await generateTTSChunkWithRetry(chunkText, apiKey, undefined, i, chunks.length);
        audioChunks.push(audioData);
        console.log(`Chunk ${i + 1} completed: ${audioData.length} bytes`);
      } catch (err) {
        console.error(`Failed to process chunk ${i + 1} after all retries:`, err);
        logger.warn(`Skipping chunk ${i + 1} due to error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        // Continue with next chunk instead of failing completely
      }
    }

    if (audioChunks.length === 0) {
      throw new Error('All audio chunks failed to generate');
    }

    console.log(`Successfully generated ${audioChunks.length}/${chunks.length} audio chunks`);

    sendEvent({ type: 'progress', progress: 70, message: 'Concatenating audio chunks...' });

    let { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);

    console.log(`Concatenated audio: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

    // Post-process to remove repeated audio segments
    sendEvent({ type: 'progress', progress: 75, message: 'Removing repeated segments...' });
    finalAudio = await postProcessAudio(finalAudio);
    console.log(`Post-processed audio: ${finalAudio.length} bytes`);

    // Apply speed adjustment if not 1.0
    if (speed !== 1.0) {
      sendEvent({ type: 'progress', progress: 80, message: `Adjusting speed to ${speed}x...` });
      finalAudio = await adjustAudioSpeed(finalAudio, speed);
      // Adjust duration based on speed (slower = longer, faster = shorter)
      durationSeconds = durationSeconds / speed;
    }

    const durationRounded = Math.round(durationSeconds);
    console.log(`Final audio: ${finalAudio.length} bytes, ${durationRounded}s`);

    sendEvent({ type: 'progress', progress: 90, message: 'Uploading audio file...' });

    const credentials = getSupabaseCredentials();
    if (!credentials) {
      sendEvent({ type: 'error', error: 'Supabase credentials not configured' });
      res.end();
      return;
    }

    const supabase = createClient(credentials.url, credentials.key);
    const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, finalAudio, {
        contentType: 'audio/wav',
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

    sendEvent({ type: 'complete', audioUrl: urlData.publicUrl, duration: durationRounded, size: finalAudio.length });
    res.end();

  } catch (error) {
    console.error('Audio error:', error);
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Audio generation failed' });
    res.end();
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// Audio segment result type
interface AudioSegmentResult {
  index: number;
  audioUrl: string;
  duration: number;
  size: number;
  text: string;
}

// Handle streaming with voice cloning - generates 10 separate segments
async function handleVoiceCloningStreaming(req: Request, res: Response, script: string, projectId: string, wordCount: number, apiKey: string, voiceSampleUrl: string, speed: number = 1.0) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keep connection alive with heartbeat every 15 seconds
  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  try {
    // Log input script stats for debugging
    const inputWordCount = script.split(/\s+/).filter(Boolean).length;
    console.log(`\n========================================`);
    console.log(`INPUT SCRIPT STATS:`);
    console.log(`  - Characters: ${script.length}`);
    console.log(`  - Words: ${inputWordCount}`);
    console.log(`  - Expected duration: ~${Math.round(inputWordCount / 150)} minutes`);
    console.log(`  - First 200 chars: "${script.substring(0, 200)}..."`);
    console.log(`========================================\n`);

    // Split script into 10 segments (uses all 10 RunPod workers)
    const segments = splitIntoSegments(script, DEFAULT_SEGMENT_COUNT);
    const actualSegmentCount = segments.length;

    // Log segment breakdown
    console.log(`SEGMENT BREAKDOWN:`);
    segments.forEach((seg, i) => {
      const segWords = seg.split(/\s+/).filter(Boolean).length;
      console.log(`  Segment ${i + 1}: ${segWords} words, ${seg.length} chars`);
    });

    sendEvent({ type: 'progress', progress: 5 });

    sendEvent({ type: 'progress', progress: 8 });

    const referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);

    const credentials = getSupabaseCredentials();
    if (!credentials) {
      sendEvent({ type: 'error', error: 'Supabase credentials not configured' });
      res.end();
      return;
    }

    const supabase = createClient(credentials.url, credentials.key);
    const actualProjectId = projectId || crypto.randomUUID();

    const MAX_CONCURRENT_SEGMENTS = 10; // Match RunPod max workers for audio endpoint
    console.log(`\n=== Processing ${actualSegmentCount} segments with rolling concurrency (max ${MAX_CONCURRENT_SEGMENTS} concurrent) ===`);

    const allSegmentResults: Array<{
      index: number;
      audioUrl: string;
      duration: number;
      size: number;
      text: string;
      audioBuffer: Buffer | null; // null until we re-download for concatenation
      durationSeconds: number;
    }> = [];

    let nextSegmentIndex = 0;
    const activeSegments = new Map<number, Promise<void>>();

    // Helper to process a single segment
    const processSegment = async (segIdx: number): Promise<void> => {
      const segmentText = segments[segIdx];
      const segmentNumber = segIdx + 1;

      console.log(`\n--- Segment ${segmentNumber}/${actualSegmentCount} STARTED ---`);
      console.log(`Text: "${segmentText.substring(0, 100)}..."`);

      try {
        // Split this segment into TTS chunks
        const rawChunks = splitIntoChunks(segmentText, MAX_TTS_CHUNK_LENGTH);
        const chunks: string[] = [];
        let skippedChunks = 0;

        for (const chunk of rawChunks) {
          if (validateTTSInput(chunk)) {
            chunks.push(chunk);
          } else {
            skippedChunks++;
            const reasons: string[] = [];
            if (!chunk) reasons.push('empty');
            else if (chunk.trim().length < MIN_TEXT_LENGTH) reasons.push(`too short (${chunk.trim().length} chars)`);
            else if (chunk.length > MAX_TEXT_LENGTH) reasons.push(`too long (${chunk.length} chars)`);
            else if (/[^\x00-\x7F]/.test(chunk)) reasons.push('contains non-ASCII');
            else if (!/[a-zA-Z0-9]/.test(chunk)) reasons.push('no alphanumeric chars');
            console.log(`  SKIPPED chunk in segment ${segmentNumber}: ${reasons.join(', ')} - "${chunk.substring(0, 50)}..."`);
          }
        }

        if (chunks.length === 0) {
          console.log(`  WARNING: Segment ${segmentNumber} has no valid chunks (${rawChunks.length} raw, ${skippedChunks} skipped)`);
          return;
        }

        console.log(`  Segment ${segmentNumber}: ${chunks.length}/${rawChunks.length} chunks valid (${skippedChunks} skipped)`);

        const audioChunks: Buffer[] = [];

        // Process each chunk in this segment sequentially
        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunkText = chunks[chunkIdx];

          const completed = allSegmentResults.length;
          const baseProgress = 10 + Math.round((completed / actualSegmentCount) * 75);
          const chunkProgress = baseProgress + Math.round(
            ((chunkIdx + 1) / chunks.length) * (75 / actualSegmentCount)
          );

          sendEvent({
            type: 'progress',
            progress: Math.min(chunkProgress, 85)
          });

          try {
            const audioData = await generateTTSChunkWithRetry(chunkText, apiKey, referenceAudioBase64, chunkIdx, chunks.length);
            audioChunks.push(audioData);
            console.log(`  Segment ${segmentNumber} - Chunk ${chunkIdx + 1}/${chunks.length}: ${audioData.length} bytes`);
          } catch (err) {
            logger.warn(`Skipping chunk ${chunkIdx + 1} in segment ${segmentNumber} after all retries: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }

        if (audioChunks.length === 0) {
          logger.warn(`All chunks failed for segment ${segmentNumber}, skipping`);
          return;
        }

        // Concatenate this segment's chunks into one WAV
        const { wav: segmentAudio, durationSeconds } = concatenateWavFiles(audioChunks);
        const durationRounded = Math.round(durationSeconds * 10) / 10;

        console.log(`Segment ${segmentNumber} audio: ${segmentAudio.length} bytes, ${durationRounded}s`);

        // Upload this segment
        const fileName = `${actualProjectId}/voiceover-segment-${segmentNumber}.wav`;

        const { error: uploadError } = await supabase.storage
          .from('generated-assets')
          .upload(fileName, segmentAudio, {
            contentType: 'audio/wav',
            upsert: true,
          });

        if (uploadError) {
          logger.error(`Failed to upload segment ${segmentNumber}: ${uploadError.message}`);
          throw new Error(`Failed to upload segment ${segmentNumber}: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
          .from('generated-assets')
          .getPublicUrl(fileName);

        console.log(`Segment ${segmentNumber} COMPLETED: ${urlData.publicUrl}`);

        // Store result (WITHOUT buffer to save memory - we'll re-download later)
        allSegmentResults.push({
          index: segmentNumber,
          audioUrl: urlData.publicUrl,
          duration: durationRounded,
          size: segmentAudio.length,
          text: segmentText,
          audioBuffer: null as any, // Placeholder - will download later
          durationSeconds,
        });

        // Send progress update
        const completed = allSegmentResults.length;
        sendEvent({
          type: 'progress',
          progress: 10 + Math.round((completed / actualSegmentCount) * 75)
        });

      } catch (err) {
        logger.error(`Segment ${segmentNumber} failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    // Helper to start next segment
    const startNextSegment = async (): Promise<void> => {
      if (nextSegmentIndex >= actualSegmentCount) return;

      const segIdx = nextSegmentIndex;
      nextSegmentIndex++;

      const promise = processSegment(segIdx).finally(() => {
        activeSegments.delete(segIdx);
      });

      activeSegments.set(segIdx, promise);
    };

    // Fill initial window with segments
    const initialBatch = Math.min(MAX_CONCURRENT_SEGMENTS, actualSegmentCount);
    console.log(`Starting initial batch of ${initialBatch} segments...`);
    for (let i = 0; i < initialBatch; i++) {
      await startNextSegment();
    }

    // Process remaining segments as active ones complete
    while (activeSegments.size > 0) {
      // Wait for any segment to complete
      await Promise.race(Array.from(activeSegments.values()));

      // Start next segment if available
      if (nextSegmentIndex < actualSegmentCount) {
        await startNextSegment();
      }
    }

    // Sort results by segment index
    const segmentResults = allSegmentResults.sort((a, b) => a.index - b.index);

    if (segmentResults.length === 0) {
      throw new Error('All segments failed to generate');
    }

    sendEvent({ type: 'progress', progress: 88 });

    // True streaming concatenation: process ONE segment at a time
    console.log(`\n=== Streaming concatenation of ${segmentResults.length} segments ===`);

    // Helper to extract WAV metadata and data
    const extractWavData = (wav: Buffer) => {
      const findChunk = (bytes: Buffer, fourcc: string) => {
        const needle = Buffer.from(fourcc, 'ascii');
        for (let i = 0; i <= bytes.length - 4; i++) {
          if (bytes.slice(i, i + 4).equals(needle)) return i;
        }
        return -1;
      };

      const fmtIdx = findChunk(wav, 'fmt ');
      const dataIdx = findChunk(wav, 'data');
      if (fmtIdx === -1 || dataIdx === -1) throw new Error('Invalid WAV format');

      const fmtDataStart = fmtIdx + 8;
      const sampleRate = wav.readUInt32LE(fmtDataStart + 4);
      const byteRate = wav.readUInt32LE(fmtDataStart + 8);
      const channels = wav.readUInt16LE(fmtDataStart + 2);
      const bitsPerSample = wav.readUInt16LE(fmtDataStart + 14);

      const dataSize = wav.readUInt32LE(dataIdx + 4);
      const dataStart = dataIdx + 8;
      const data = wav.slice(dataStart, Math.min(wav.length, dataStart + dataSize));

      return { header: wav.slice(0, dataStart), data, dataIdx, sampleRate, byteRate, channels, bitsPerSample };
    };

    // Step 1: Download first segment to get header and calculate total size
    console.log(`Step 1: Downloading first segment for header info...`);
    const firstFileName = `${actualProjectId}/voiceover-segment-${segmentResults[0].index}.wav`;
    const { data: firstData, error: firstError } = await supabase.storage
      .from('generated-assets')
      .download(firstFileName);

    if (firstError || !firstData) {
      throw new Error(`Failed to download first segment: ${firstError?.message}`);
    }

    const firstBuffer = Buffer.from(await firstData.arrayBuffer());
    const firstExtracted = extractWavData(firstBuffer);

    // Calculate total PCM size (first segment + estimate for remaining based on file sizes)
    let totalPcmSize = firstExtracted.data.length;
    const headerSize = firstExtracted.header.length;

    for (let i = 1; i < segmentResults.length; i++) {
      // Estimate PCM size as (total file size - header overhead ~100 bytes)
      totalPcmSize += Math.max(0, segmentResults[i].size - 100);
    }

    console.log(`Estimated total PCM size: ${totalPcmSize} bytes from ${segmentResults.length} segments`);

    sendEvent({ type: 'progress', progress: 90 });

    // Step 2: Allocate output buffer
    const combinedAudio = Buffer.alloc(headerSize + totalPcmSize);

    // Copy header from first segment
    firstExtracted.header.copy(combinedAudio, 0);

    // Update size fields
    const dataIdxInCombined = firstExtracted.dataIdx;
    combinedAudio.writeUInt32LE(combinedAudio.length - 8, 4); // RIFF size
    combinedAudio.writeUInt32LE(totalPcmSize, dataIdxInCombined + 4); // data size

    // Step 3: Copy first segment's PCM data
    let offset = headerSize;
    firstExtracted.data.copy(combinedAudio, offset);
    offset += firstExtracted.data.length;
    console.log(`Segment 1: copied ${firstExtracted.data.length} bytes, offset now ${offset}`);

    // Clear first buffer (help GC)
    firstBuffer.fill(0);

    // Step 4: Stream remaining segments one at a time
    for (let i = 1; i < segmentResults.length; i++) {
      const result = segmentResults[i];
      const fileName = `${actualProjectId}/voiceover-segment-${result.index}.wav`;

      console.log(`Streaming segment ${i + 1}/${segmentResults.length}: ${fileName}...`);

      const { data, error } = await supabase.storage
        .from('generated-assets')
        .download(fileName);

      if (error || !data) {
        throw new Error(`Failed to download segment ${result.index}: ${error?.message}`);
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      const extracted = extractWavData(buffer);

      // Copy just the PCM data
      extracted.data.copy(combinedAudio, offset);
      offset += extracted.data.length;

      console.log(`Segment ${i + 1}: copied ${extracted.data.length} bytes, offset now ${offset}`);

      // Clear buffer immediately (only holds 1 segment at a time)
      buffer.fill(0);
    }

    // Adjust final size if estimate was off
    const actualCombinedSize = offset;
    if (actualCombinedSize !== combinedAudio.length) {
      console.log(`Size adjustment: estimated ${combinedAudio.length}, actual ${actualCombinedSize}`);
      combinedAudio.writeUInt32LE(actualCombinedSize - 8, 4);
      combinedAudio.writeUInt32LE(actualCombinedSize - headerSize, dataIdxInCombined + 4);
    }

    let totalDuration = segmentResults.reduce((sum, r) => sum + r.durationSeconds, 0);
    let combinedDuration = firstExtracted.byteRate > 0 ? (actualCombinedSize - headerSize) / firstExtracted.byteRate : totalDuration;

    console.log(`Combined audio: ${combinedAudio.length} bytes, ${Math.round(combinedDuration)}s`);

    // Post-process to remove repeated audio segments
    sendEvent({ type: 'progress', progress: 90, message: 'Removing repeated segments...' });
    let finalAudio: Buffer = await postProcessAudio(combinedAudio);
    console.log(`Post-processed audio: ${finalAudio.length} bytes`);

    // Apply speed adjustment if not 1.0
    if (speed !== 1.0) {
      sendEvent({ type: 'progress', progress: 92, message: `Adjusting speed to ${speed}x...` });
      finalAudio = await adjustAudioSpeed(finalAudio, speed);
      // Adjust duration based on speed (slower = longer, faster = shorter)
      combinedDuration = combinedDuration / speed;
      totalDuration = totalDuration / speed;
      console.log(`Speed-adjusted audio: ${finalAudio.length} bytes, ${Math.round(combinedDuration)}s`);
    }

    const combinedFileName = `${actualProjectId}/voiceover.wav`;
    sendEvent({ type: 'progress', progress: 95 });

    console.log(`\n=== Uploading combined audio ===`);
    console.log(`Final audio: ${finalAudio.length} bytes, ${Math.round(combinedDuration)}s`);

    const { error: combinedUploadError } = await supabase.storage
      .from('generated-assets')
      .upload(combinedFileName, finalAudio, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (combinedUploadError) {
      logger.error(`Failed to upload combined audio: ${combinedUploadError.message}`);
      throw new Error(`Failed to upload combined audio: ${combinedUploadError.message}`);
    }

    const { data: combinedUrlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(combinedFileName);

    sendEvent({ type: 'progress', progress: 98 });

    console.log(`\n=== All ${segmentResults.length} segments complete ===`);
    console.log(`Combined audio URL: ${combinedUrlData.publicUrl}`);
    console.log(`Total duration: ${Math.round(totalDuration)}s`);

    // Clean up segment results for client (remove internal fields)
    const cleanedSegments: AudioSegmentResult[] = segmentResults.map(r => ({
      index: r.index,
      audioUrl: r.audioUrl,
      duration: r.duration,
      size: r.size,
      text: r.text,
    }));

    sendEvent({
      type: 'complete',
      success: true,
      audioUrl: combinedUrlData.publicUrl, // Combined audio for playback
      duration: Math.round(combinedDuration),
      size: finalAudio.length,
      segments: cleanedSegments, // Individual segments for regeneration
      totalDuration: Math.round(totalDuration),
      wordCount,
    });
    res.end();

  } catch (error) {
    console.error('Audio error:', error);
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Audio generation failed' });
    res.end();
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// Handle non-streaming (with or without voice cloning) - SEQUENTIAL - Memory optimized
async function handleNonStreaming(req: Request, res: Response, chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl?: string, speed: number = 1.0) {
  let referenceAudioBase64: string | undefined;
  if (voiceSampleUrl) {
    console.log('Downloading voice sample for cloning...');
    referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);
  }

  console.log(`\n=== Processing ${chunks.length} chunks sequentially ===`);

  const audioChunks: Buffer[] = [];

  // Process each chunk sequentially
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);

    try {
      // Start the TTS job with reference_audio_base64 for cloning (if provided)
      const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
      console.log(`TTS job started with ID: ${jobId}`);

      // Poll for completion
      const output = await pollJobStatus(jobId, apiKey);

      // Decode audio
      const audioData = base64ToBuffer(output.audio_base64);
      audioChunks.push(audioData);
      console.log(`Chunk ${i + 1} completed: ${audioData.length} bytes`);
    } catch (err) {
      console.error(`Failed to process chunk ${i + 1}:`, err);
      logger.warn(`Skipping chunk ${i + 1} due to error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // Continue with next chunk instead of failing completely
    }
  }

  if (audioChunks.length === 0) {
    return res.status(500).json({ success: false, error: 'All audio chunks failed to generate' });
  }

  console.log(`Successfully generated ${audioChunks.length}/${chunks.length} audio chunks`);

  let { wav: combinedAudio, durationSeconds } = concatenateWavFiles(audioChunks);

  console.log(`Concatenated audio: ${combinedAudio.length} bytes from ${audioChunks.length} chunks`);

  // Post-process to remove repeated audio segments
  console.log('Post-processing to remove repeated segments...');
  let finalAudio = await postProcessAudio(combinedAudio);
  console.log(`Post-processed audio: ${finalAudio.length} bytes`);

  // Apply speed adjustment if not 1.0
  if (speed !== 1.0) {
    console.log(`Adjusting speed to ${speed}x...`);
    finalAudio = await adjustAudioSpeed(finalAudio, speed);
    // Adjust duration based on speed (slower = longer, faster = shorter)
    durationSeconds = durationSeconds / speed;
    console.log(`Speed-adjusted audio: ${finalAudio.length} bytes, ${Math.round(durationSeconds)}s`);
  }

  const durationRounded = Math.round(durationSeconds);
  console.log(`Final audio: ${finalAudio.length} bytes, ${durationRounded}s`);

  const credentials = getSupabaseCredentials();
  if (!credentials) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const supabase = createClient(credentials.url, credentials.key);
  const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;

  const { error: uploadError } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, finalAudio, {
      contentType: 'audio/wav',
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
    size: finalAudio.length
  });
}

// Regenerate a single segment
router.post('/segment', async (req: Request, res: Response) => {
  const { segmentText, segmentIndex, voiceSampleUrl, projectId } = req.body;

  try {
    if (!segmentText) {
      return res.status(400).json({ error: 'segmentText is required' });
    }
    if (!segmentIndex || segmentIndex < 1 || segmentIndex > DEFAULT_SEGMENT_COUNT) {
      return res.status(400).json({ error: `segmentIndex must be between 1 and ${DEFAULT_SEGMENT_COUNT}` });
    }
    if (!voiceSampleUrl) {
      return res.status(400).json({ error: 'voiceSampleUrl is required' });
    }
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    if (!RUNPOD_API_KEY) {
      return res.status(500).json({ error: 'RUNPOD_API_KEY not configured' });
    }

    const credentials = getSupabaseCredentials();
    if (!credentials) {
      return res.status(500).json({ error: 'Supabase credentials not configured' });
    }

    logger.info(`Regenerating segment ${segmentIndex} for project ${projectId}`);

    // Download voice sample
    const referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);

    // Normalize and chunk the segment text
    const normalizedText = normalizeText(segmentText);
    const rawChunks = splitIntoChunks(normalizedText, MAX_TTS_CHUNK_LENGTH);
    const chunks: string[] = [];

    for (const chunk of rawChunks) {
      if (validateTTSInput(chunk)) {
        chunks.push(chunk);
      }
    }

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No valid text chunks in segment' });
    }

    console.log(`Segment ${segmentIndex}: processing ${chunks.length} chunks`);

    const audioChunks: Buffer[] = [];

    // Process each chunk sequentially
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);

      try {
        const jobId = await startTTSJob(chunkText, RUNPOD_API_KEY, referenceAudioBase64);
        const output = await pollJobStatus(jobId, RUNPOD_API_KEY);
        const audioData = base64ToBuffer(output.audio_base64);
        audioChunks.push(audioData);
        console.log(`Chunk ${i + 1}/${chunks.length}: ${audioData.length} bytes`);
      } catch (err) {
        logger.warn(`Skipping chunk ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    if (audioChunks.length === 0) {
      return res.status(500).json({ error: 'All chunks failed to generate' });
    }

    // Concatenate chunks into segment audio
    const { wav: segmentAudio, durationSeconds } = concatenateWavFiles(audioChunks);
    const durationRounded = Math.round(durationSeconds * 10) / 10;

    console.log(`Segment ${segmentIndex} audio: ${segmentAudio.length} bytes, ${durationRounded}s`);

    // Upload to Supabase
    const supabase = createClient(credentials.url, credentials.key);
    const fileName = `${projectId}/voiceover-segment-${segmentIndex}.wav`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, segmentAudio, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      logger.error(`Failed to upload segment: ${uploadError.message}`);
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` });
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    console.log(`Segment ${segmentIndex} regenerated: ${urlData.publicUrl}`);

    return res.json({
      success: true,
      segment: {
        index: segmentIndex,
        audioUrl: urlData.publicUrl,
        duration: durationRounded,
        size: segmentAudio.length,
        text: segmentText,
      },
    });

  } catch (error) {
    logger.error('Error regenerating segment:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Segment regeneration failed'
    });
  }
});

export default router;
