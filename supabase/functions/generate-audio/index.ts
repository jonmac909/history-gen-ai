import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_ENDPOINT_ID = "vo9tpom0pvi9zk";
const RUNPOD_API_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

// Hard validation - reject early if text is unsafe
function validateTTSInput(text: string): boolean {
  if (!text) return false;
  if (text.trim().length < 5) return false;
  if (text.length > 400) return false;

  // reject emojis & non-basic unicode
  if (/[^\x00-\x7F]/.test(text)) return false;

  // must contain letters or numbers
  if (!/[a-zA-Z0-9]/.test(text)) return false;

  return true;
}

// Mandatory normalization before sending to API
function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")   // strip unicode
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Split text into safe chunks at sentence boundaries
function splitIntoChunks(text: string, maxLength: number = 180): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    // If single sentence is too long, split by commas or force split
    if (sentence.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      // Try splitting by commas first
      const parts = sentence.split(/,\s*/);
      let partChunk = "";
      for (const part of parts) {
        if (part.length > maxLength) {
          // Force split at maxLength
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, voiceSampleUrl, projectId, stream } = await req.json();
    
    if (!script) {
      return new Response(
        JSON.stringify({ error: 'Script is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const RUNPOD_API_KEY = Deno.env.get('RUNPOD_API_KEY');
    if (!RUNPOD_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RUNPOD_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean script - remove image prompts and markdown
    let cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Apply mandatory normalization
    cleanScript = normalizeText(cleanScript);
    
    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio for ${wordCount} words with Chatterbox TTS...`);
    console.log(`Normalized text length: ${cleanScript.length} chars`);

    // Split into chunks for safety (Chatterbox crashes on long text)
    const chunks = splitIntoChunks(cleanScript, 180);
    console.log(`Split into ${chunks.length} chunks`);

    // Validate each chunk
    for (let i = 0; i < chunks.length; i++) {
      if (!validateTTSInput(chunks[i])) {
        console.error(`Chunk ${i + 1} failed validation: "${chunks[i].substring(0, 50)}..."`);
        return new Response(
          JSON.stringify({ error: `Text chunk ${i + 1} contains invalid characters or is too short/long` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Voice cloning - now supports streaming!
    if (voiceSampleUrl) {
      console.log('Voice cloning detected');
      console.log(`Voice sample URL: ${voiceSampleUrl}`);

      // Pre-validate voice sample accessibility
      try {
        console.log('Pre-validating voice sample accessibility...');
        const testResponse = await fetch(voiceSampleUrl, { method: 'HEAD' });
        if (!testResponse.ok) {
          console.error(`Voice sample not accessible: HTTP ${testResponse.status}`);
          return new Response(
            JSON.stringify({ error: `Voice sample not accessible (HTTP ${testResponse.status}). Please re-upload your voice sample.` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log('Voice sample is accessible');
      } catch (error) {
        console.error('Failed to access voice sample:', error);
        return new Response(
          JSON.stringify({ error: `Cannot access voice sample: ${error instanceof Error ? error.message : 'Network error'}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use streaming for voice cloning if requested
      if (stream) {
        console.log('Using streaming mode with voice cloning');
        return generateVoiceCloningWithStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
      } else {
        console.log('Using non-streaming mode with voice cloning');
        return generateWithoutStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
      }
    }

    if (stream) {
      return generateWithStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY);
    } else {
      return generateWithoutStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY);
    }

  } catch (error) {
    console.error('Error generating audio:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Audio generation failed'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Download voice sample and convert to base64
async function downloadVoiceSample(url: string): Promise<string> {
  console.log(`Downloading voice sample from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download voice sample: HTTP ${response.status} ${response.statusText}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    console.log(`Voice sample content-type: ${contentType}`);

    if (contentType && !contentType.includes('audio')) {
      console.warn(`Unexpected content-type: ${contentType}. Expected audio/* type.`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length === 0) {
      throw new Error('Voice sample is empty (0 bytes)');
    }

    if (bytes.length > 10 * 1024 * 1024) {
      throw new Error(`Voice sample too large: ${bytes.length} bytes (max 10MB)`);
    }

    // Verify it looks like a valid audio file (check for common audio file signatures)
    const header = new TextDecoder().decode(bytes.subarray(0, 4));
    if (header === 'RIFF' || header.startsWith('ID3') || header.startsWith('\xFF\xFB')) {
      console.log(`Voice sample format detected: ${header === 'RIFF' ? 'WAV' : header.startsWith('ID3') ? 'MP3' : 'MP3'}`);
    } else {
      console.warn(`Unknown audio format. First 4 bytes: ${Array.from(bytes.subarray(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

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

// Chatterbox only supports cloning via reference_audio_base64
// The worker decodes it and passes as reference_audio + reference_sr to synthesize()
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

  // CANONICAL FIELD for Chatterbox voice cloning
  // Worker must decode this and pass as reference_audio (and reference_sr) to tts.synthesize()
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

    const result = await response.json();
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

async function pollJobStatus(jobId: string, apiKey: string): Promise<{ audio_base64: string; sample_rate: number }> {
  const maxAttempts = 120; // 2 minutes max
  const pollInterval = 2000; // 2 seconds

  console.log(`\n=== Polling Job Status ===`);
  console.log(`Job ID: ${jobId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt % 5 === 0 || attempt < 3) {
      console.log(`Polling attempt ${attempt + 1}/${maxAttempts}...`);
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

    const result = await response.json();
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

    // Log queue position if available
    if (result.delayTime) {
      console.log(`Estimated delay: ${result.delayTime}ms`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.error(`\n!!! Job Timeout !!!`);
  console.error(`Job ID: ${jobId} timed out after ${maxAttempts * pollInterval / 1000} seconds`);
  throw new Error('TTS job timed out after 2 minutes');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Concatenate multiple WAV files by extracting the actual PCM data chunk from each file.
// This is more robust than assuming a fixed 44-byte header because some WAVs include extra chunks.
function concatenateWavFiles(audioChunks: Uint8Array[]): { wav: Uint8Array; durationSeconds: number } {
  if (audioChunks.length === 0) {
    throw new Error('No audio chunks to concatenate');
  }

  const findChunk = (bytes: Uint8Array, fourcc: string) => {
    const needle = new TextEncoder().encode(fourcc);
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (
        bytes[i] === needle[0] &&
        bytes[i + 1] === needle[1] &&
        bytes[i + 2] === needle[2] &&
        bytes[i + 3] === needle[3]
      ) {
        return i;
      }
    }
    return -1;
  };

  const extract = (wav: Uint8Array) => {
    if (wav.length < 16) throw new Error('WAV chunk too small');

    // Basic RIFF/WAVE sanity check (best-effort)
    const riff = new TextDecoder().decode(wav.subarray(0, 4));
    const wave = new TextDecoder().decode(wav.subarray(8, 12));
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      console.warn('Unexpected WAV header (not RIFF/WAVE); attempting to parse anyway');
    }

    const fmtIdx = findChunk(wav, 'fmt ');
    const dataIdx = findChunk(wav, 'data');
    if (fmtIdx === -1) throw new Error('Missing fmt chunk in WAV');
    if (dataIdx === -1) throw new Error('Missing data chunk in WAV');

    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    // fmt chunk layout
    const fmtDataStart = fmtIdx + 8;
    const audioFormat = dv.getUint16(fmtDataStart + 0, true);
    const channels = dv.getUint16(fmtDataStart + 2, true);
    const sampleRate = dv.getUint32(fmtDataStart + 4, true);
    const byteRate = dv.getUint32(fmtDataStart + 8, true);
    const bitsPerSample = dv.getUint16(fmtDataStart + 14, true);

    if (audioFormat !== 1) {
      console.warn(`Non-PCM WAV detected (audioFormat=${audioFormat}). Browser playback may fail.`);
    }

    const dataSizeOffset = dataIdx + 4;
    const dataSize = dv.getUint32(dataSizeOffset, true);
    const dataStart = dataIdx + 8;
    const dataEnd = Math.min(wav.length, dataStart + dataSize);

    const header = wav.subarray(0, dataStart);
    const data = wav.subarray(dataStart, dataEnd);

    return { header, data, dataIdx, dataSizeOffset, sampleRate, channels, bitsPerSample, byteRate };
  };

  const first = extract(audioChunks[0]);

  // Extract PCM data from each chunk
  const extracted = audioChunks.map(extract);

  // Total data bytes
  const totalDataSize = extracted.reduce((sum, e) => sum + e.data.length, 0);

  // Output header = everything before the first chunk's data bytes (includes 'data' + size field)
  const output = new Uint8Array(first.header.length + totalDataSize);
  output.set(first.header, 0);

  // Update RIFF chunk size (at offset 4) => fileSize - 8
  const outDv = new DataView(output.buffer);
  outDv.setUint32(4, output.length - 8, true);

  // Update data chunk size (at the first chunk's data size offset)
  outDv.setUint32(first.dataSizeOffset, totalDataSize, true);

  // Copy all PCM data back-to-back
  let offset = first.header.length;
  for (const e of extracted) {
    output.set(e.data, offset);
    offset += e.data.length;
  }

  // Duration estimate from byteRate if available
  const safeByteRate = first.byteRate || (first.sampleRate * first.channels * (first.bitsPerSample / 8));
  const durationSeconds = safeByteRate > 0 ? totalDataSize / safeByteRate : 0;

  return { wav: output, durationSeconds };
}

// Streaming mode - only used when NO voice cloning (default voice)
async function generateWithStreaming(chunks: string[], projectId: string, wordCount: number, apiKey: string): Promise<Response> {
  const encoder = new TextEncoder();
  
  const responseStream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      
      // Safe enqueue helper - handles closed stream gracefully
      const safeEnqueue = (data: string) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(data));
          return true;
        } catch {
          streamClosed = true;
          console.log('Stream closed by client');
          return false;
        }
      };

      try {
        safeEnqueue(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 5,
          message: `Starting Chatterbox TTS (${chunks.length} chunks, default voice)...`
        })}\n\n`);

        const audioChunks: Uint8Array[] = [];

        // Process each chunk sequentially (no voice cloning in streaming mode)
        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);
          
          safeEnqueue(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 5 + Math.round((i / chunks.length) * 60),
            message: `Generating audio chunk ${i + 1}/${chunks.length}...`
          })}\n\n`);

          // Start the TTS job for this chunk (no voice reference in streaming mode)
          const jobId = await startTTSJob(chunkText, apiKey);
          
          // Poll for completion
          const maxAttempts = 120;
          const pollInterval = 2000;
          let output: { audio_base64: string; sample_rate: number } | null = null;
          
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetch(`${RUNPOD_API_URL}/status/${jobId}`, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });

            if (!response.ok) {
              throw new Error(`Failed to poll job status: ${response.status}`);
            }

            const result = await response.json();
            
             if (result.status === 'COMPLETED') {
               if (!result.output?.audio_base64) {
                 throw new Error('No audio_base64 in completed job output');
               }
               output = result.output;
               break;
             }

            if (result.status === 'FAILED') {
              throw new Error(`TTS job failed for chunk ${i + 1}: ${result.error || 'Unknown error'}`);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }

          if (!output) {
            throw new Error(`TTS job timed out for chunk ${i + 1}`);
          }

          // Decode and store this chunk's audio
          const audioData = base64ToUint8Array(output.audio_base64);
          audioChunks.push(audioData);
          console.log(`Chunk ${i + 1} completed: ${audioData.length} bytes`);
        }

        safeEnqueue(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 75,
          message: 'Concatenating audio chunks...'
        })}\n\n`);

        // Concatenate all audio chunks (robust parsing of WAV data chunk)
        const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
        const durationRounded = Math.round(durationSeconds);

        console.log(`Final audio: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

        safeEnqueue(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 85,
          message: 'Uploading audio file...'
        })}\n\n`);

        // Upload to Supabase Storage
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;

        const { error: uploadError } = await supabase.storage
          .from('generated-assets')
          .upload(fileName, finalAudio, {
            contentType: 'audio/wav',
            upsert: true,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          safeEnqueue(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'Failed to upload audio' 
          })}\n\n`);
          try { controller.close(); } catch { /* already closed */ }
          return;
        }

        const { data: urlData } = supabase.storage
          .from('generated-assets')
          .getPublicUrl(fileName);

        console.log('Audio uploaded:', urlData.publicUrl);

        safeEnqueue(`data: ${JSON.stringify({ 
          type: 'complete', 
          audioUrl: urlData.publicUrl,
          duration: durationRounded,
          size: finalAudio.length
        })}\n\n`);

      } catch (error) {
        console.error('Audio error:', error);
        safeEnqueue(`data: ${JSON.stringify({ 
          type: 'error', 
          error: error instanceof Error ? error.message : 'Audio generation failed' 
        })}\n\n`);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    }
  });

  return new Response(responseStream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}

// Streaming mode with voice cloning support
async function generateVoiceCloningWithStreaming(chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl: string): Promise<Response> {
  const encoder = new TextEncoder();

  const responseStream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;

      // Safe enqueue helper
      const safeEnqueue = (data: string) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(data));
          return true;
        } catch {
          streamClosed = true;
          console.log('Stream closed by client');
          return false;
        }
      };

      try {
        safeEnqueue(`data: ${JSON.stringify({
          type: 'progress',
          progress: 5,
          message: `Starting voice cloning (${chunks.length} chunks)...`
        })}\n\n`);

        // Download voice sample
        safeEnqueue(`data: ${JSON.stringify({
          type: 'progress',
          progress: 10,
          message: 'Downloading voice sample...'
        })}\n\n`);

        const referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
        console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);

        const audioChunks: Uint8Array[] = [];

        // Process each chunk with progress updates
        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          const chunkProgress = 15 + Math.round((i / chunks.length) * 60);

          console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);

          safeEnqueue(`data: ${JSON.stringify({
            type: 'progress',
            progress: chunkProgress,
            message: `Generating audio chunk ${i + 1}/${chunks.length} with voice cloning...`
          })}\n\n`);

          // Start TTS job with voice cloning
          const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
          console.log(`TTS job started with ID: ${jobId}`);

          // Poll for completion
          const output = await pollJobStatus(jobId, apiKey);

          // Decode audio
          const audioData = base64ToUint8Array(output.audio_base64);
          audioChunks.push(audioData);
          console.log(`Chunk ${i + 1} completed: ${audioData.length} bytes`);
        }

        safeEnqueue(`data: ${JSON.stringify({
          type: 'progress',
          progress: 80,
          message: 'Concatenating audio chunks...'
        })}\n\n`);

        // Concatenate audio
        const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
        const durationRounded = Math.round(durationSeconds);

        console.log(`Final audio: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

        safeEnqueue(`data: ${JSON.stringify({
          type: 'progress',
          progress: 90,
          message: 'Uploading audio...'
        })}\n\n`);

        // Upload to Supabase Storage
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;

        const { error: uploadError } = await supabase.storage
          .from('generated-assets')
          .upload(fileName, finalAudio, {
            contentType: 'audio/wav',
            upsert: true,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error('Failed to upload audio');
        }

        const { data: urlData } = supabase.storage
          .from('generated-assets')
          .getPublicUrl(fileName);

        safeEnqueue(`data: ${JSON.stringify({
          type: 'complete',
          success: true,
          audioUrl: urlData.publicUrl,
          duration: durationRounded,
          wordCount,
          size: finalAudio.length
        })}\n\n`);

      } catch (error) {
        console.error('Audio error:', error);
        safeEnqueue(`data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Audio generation failed'
        })}\n\n`);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    }
  });

  return new Response(responseStream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}

// Non-streaming mode - used for voice cloning (required) or when stream=false
async function generateWithoutStreaming(chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl?: string): Promise<Response> {
  const audioChunks: Uint8Array[] = [];

  // Download voice sample once and convert to base64 for Chatterbox
  let referenceAudioBase64: string | undefined;
  if (voiceSampleUrl) {
    console.log('Downloading voice sample for cloning...');
    referenceAudioBase64 = await downloadVoiceSample(voiceSampleUrl);
    console.log(`Voice sample ready: ${referenceAudioBase64.length} chars base64`);
  }

  // Process each chunk sequentially
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);

    // Start the TTS job with reference_audio_base64 for cloning
    const jobId = await startTTSJob(chunkText, apiKey, referenceAudioBase64);
    console.log(`TTS job started with ID: ${jobId}`);

    // Poll for completion
    const output = await pollJobStatus(jobId, apiKey);

    // Decode audio
    const audioData = base64ToUint8Array(output.audio_base64);
    audioChunks.push(audioData);
    console.log(`Chunk ${i + 1} completed: ${audioData.length} bytes`);
  }

  // Concatenate all audio chunks (robust parsing of WAV data chunk)
  const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
  const durationRounded = Math.round(durationSeconds);
  
  console.log(`Final audio: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

  // Upload to Supabase Storage
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
  
  const { error: uploadError } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, finalAudio, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (uploadError) {
    console.error('Upload error:', uploadError);
    throw new Error('Failed to upload audio');
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  return new Response(
    JSON.stringify({
      success: true,
      audioUrl: urlData.publicUrl,
      duration: durationRounded,
      wordCount,
      size: finalAudio.length
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
