import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_ENDPOINT_ID = "n4m8bw1kmrdd9e";
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

    if (stream) {
      return generateWithStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
    } else {
      return generateWithoutStreaming(chunks, projectId, wordCount, RUNPOD_API_KEY, voiceSampleUrl);
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

async function startTTSJob(text: string, apiKey: string, voiceSampleUrl?: string): Promise<string> {
  console.log(`Starting TTS job at ${RUNPOD_API_URL}/run`);
  console.log(`Text length: ${text.length} chars`);
  console.log(`Voice sample URL: ${voiceSampleUrl || 'none (using default)'}`);
  
  const inputPayload: Record<string, unknown> = {
    text: text,
    prompt: text
  };
  
  // Add voice sample URL for voice cloning if provided
  if (voiceSampleUrl) {
    inputPayload.audio_prompt_path = voiceSampleUrl;
  }
  
  const response = await fetch(`${RUNPOD_API_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: inputPayload
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to start TTS job:', response.status, errorText);
    throw new Error(`Failed to start TTS job: ${response.status}`);
  }

  const result = await response.json();
  console.log('TTS job started:', result);
  
  if (!result.id) {
    throw new Error('No job ID returned from RunPod');
  }
  
  return result.id;
}

async function pollJobStatus(jobId: string, apiKey: string): Promise<{ audio_base64: string; sample_rate: number }> {
  const maxAttempts = 120; // 2 minutes max
  const pollInterval = 2000; // 2 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(`Polling job status (attempt ${attempt + 1}/${maxAttempts})...`);
    
    const response = await fetch(`${RUNPOD_API_URL}/status/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to poll job status:', response.status, errorText);
      throw new Error(`Failed to poll job status: ${response.status}`);
    }

    const result = await response.json();
    console.log(`Job status: ${result.status}`);

    if (result.status === 'COMPLETED') {
      if (!result.output?.audio_base64) {
        throw new Error('No audio_base64 in completed job output');
      }
      return result.output;
    }

    if (result.status === 'FAILED') {
      console.error('TTS job failed:', result);
      throw new Error(`TTS job failed: ${result.error || 'Unknown error'}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

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

async function generateWithStreaming(chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl?: string): Promise<Response> {
  const encoder = new TextEncoder();
  
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 5,
          message: `Starting Chatterbox TTS (${chunks.length} chunks)...`
        })}\n\n`));

        const audioChunks: Uint8Array[] = [];

        // Process each chunk sequentially
        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 5 + Math.round((i / chunks.length) * 60),
            message: `Generating audio chunk ${i + 1}/${chunks.length}...`
          })}\n\n`));

          // Start the TTS job for this chunk with voice sample
          const jobId = await startTTSJob(chunkText, apiKey, voiceSampleUrl);
          
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

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 75,
          message: 'Concatenating audio chunks...'
        })}\n\n`));

        // Concatenate all audio chunks (robust parsing of WAV data chunk)
        const { wav: finalAudio, durationSeconds } = concatenateWavFiles(audioChunks);
        const durationRounded = Math.round(durationSeconds);

        console.log(`Final audio: ${finalAudio.length} bytes from ${audioChunks.length} chunks`);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 85,
          message: 'Uploading audio file...'
        })}\n\n`));

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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'Failed to upload audio' 
          })}\n\n`));
          controller.close();
          return;
        }

        const { data: urlData } = supabase.storage
          .from('generated-assets')
          .getPublicUrl(fileName);

        console.log('Audio uploaded:', urlData.publicUrl);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'complete', 
          audioUrl: urlData.publicUrl,
          duration: durationRounded,
          size: finalAudio.length
        })}\n\n`));

      } catch (error) {
        console.error('Audio error:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          error: error instanceof Error ? error.message : 'Audio generation failed' 
        })}\n\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(responseStream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}

async function generateWithoutStreaming(chunks: string[], projectId: string, wordCount: number, apiKey: string, voiceSampleUrl?: string): Promise<Response> {
  const audioChunks: Uint8Array[] = [];

  // Process each chunk sequentially
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 50)}..."`);
    
    // Start the TTS job for this chunk with voice sample
    const jobId = await startTTSJob(chunkText, apiKey, voiceSampleUrl);
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
