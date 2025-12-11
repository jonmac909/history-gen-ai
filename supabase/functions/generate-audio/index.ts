import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Split script into chunks at natural boundaries (paragraphs, sections)
function splitScriptIntoChunks(script: string, maxChunkWords: number = 1500): string[] {
  const chunks: string[] = [];
  
  // Split by double newlines (paragraphs) or section headers
  const sections = script.split(/\n\n+/);
  let currentChunk = "";
  let currentWordCount = 0;
  
  for (const section of sections) {
    const sectionWords = section.split(/\s+/).filter(Boolean).length;
    
    // If adding this section would exceed limit, save current chunk and start new one
    if (currentWordCount + sectionWords > maxChunkWords && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = section;
      currentWordCount = sectionWords;
    } else {
      // Add section to current chunk
      currentChunk += (currentChunk ? "\n\n" : "") + section;
      currentWordCount += sectionWords;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Generate audio for a single chunk using SSE endpoint
async function generateChunkAudio(
  chunk: string, 
  voiceId: string, 
  apiKey: string,
  contextId: string,
  isFirstChunk: boolean
): Promise<Uint8Array> {
  console.log(`Generating audio for chunk (${chunk.split(/\s+/).length} words), isFirst: ${isFirstChunk}`);
  
  const response = await fetch('https://api.cartesia.ai/tts/sse', {
    method: 'POST',
    headers: {
      'Cartesia-Version': '2025-04-16',
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: 'sonic-3',
      transcript: chunk,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 44100,
      },
      context_id: contextId,
      // Use continue=true for subsequent chunks to maintain prosody
      ...(isFirstChunk ? {} : { continue: true }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Cartesia SSE error:', response.status, errorText);
    throw new Error(`Cartesia API error: ${response.status} - ${errorText}`);
  }

  // Parse SSE response and collect audio chunks
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const audioChunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Process complete SSE events
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    
    for (const event of events) {
      if (!event.trim()) continue;
      
      const lines = event.split('\n');
      let eventData = '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        }
      }
      
      if (eventData) {
        try {
          const parsed = JSON.parse(eventData);
          
          if (parsed.type === 'chunk' && parsed.data) {
            // Decode base64 audio data
            const binaryString = atob(parsed.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            audioChunks.push(bytes);
          } else if (parsed.type === 'done') {
            console.log('Chunk generation complete');
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          // Skip invalid JSON
          if (eventData !== '[DONE]') {
            console.warn('Failed to parse SSE event:', eventData.substring(0, 100));
          }
        }
      }
    }
  }

  // Combine all audio chunks
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  console.log(`Chunk audio generated: ${combined.length} bytes`);
  return combined;
}

// Create WAV header for PCM data
function createWavHeader(dataLength: number, sampleRate: number = 44100, channels: number = 1, bitsPerSample: number = 16): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Chunk size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, channels, true); // Channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * channels * bitsPerSample / 8, true); // Byte rate
  view.setUint16(32, channels * bitsPerSample / 8, true); // Block align
  view.setUint16(34, bitsPerSample, true); // Bits per sample
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true); // Data size
  
  return new Uint8Array(header);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, voiceId, projectId } = await req.json();
    
    if (!script) {
      return new Response(
        JSON.stringify({ error: 'Script is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!voiceId) {
      return new Response(
        JSON.stringify({ error: 'Voice ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const CARTESIA_API_KEY = Deno.env.get('CARTESIA_API_KEY');
    if (!CARTESIA_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Cartesia API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean script - remove visual cues in brackets for audio
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '') // Remove markdown headers
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // Remove bold/italic
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio with Cartesia for ${wordCount} words...`);

    // Split into chunks for long scripts (>2000 words)
    const chunks = wordCount > 2000 
      ? splitScriptIntoChunks(cleanScript, 1500) 
      : [cleanScript];
    
    console.log(`Split into ${chunks.length} chunks`);

    // Generate unique context ID for this generation
    const contextId = `gen-${projectId || crypto.randomUUID()}`;
    
    // Generate audio for each chunk
    const audioChunks: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const chunkAudio = await generateChunkAudio(
        chunks[i], 
        voiceId, 
        CARTESIA_API_KEY,
        contextId,
        i === 0
      );
      audioChunks.push(chunkAudio);
    }

    // Combine all audio chunks
    const totalPcmLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedPcm = new Uint8Array(totalPcmLength);
    let offset = 0;
    for (const chunk of audioChunks) {
      combinedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    console.log(`Combined PCM audio: ${combinedPcm.length} bytes`);

    // Create WAV file with header
    const wavHeader = createWavHeader(combinedPcm.length);
    const wavFile = new Uint8Array(wavHeader.length + combinedPcm.length);
    wavFile.set(wavHeader, 0);
    wavFile.set(combinedPcm, wavHeader.length);

    console.log(`Final WAV file: ${wavFile.length} bytes`);

    // Upload to Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, wavFile, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload audio file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    console.log('Audio uploaded successfully:', urlData.publicUrl);

    // Calculate approximate duration (44100 samples/sec * 2 bytes per sample * 1 channel)
    const durationSeconds = Math.round(combinedPcm.length / (44100 * 2));

    // Return base64 for immediate playback (only if file is small enough)
    let base64Audio = '';
    if (wavFile.length < 10 * 1024 * 1024) { // Only if < 10MB
      base64Audio = base64Encode(wavFile.buffer);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        audioUrl: urlData.publicUrl,
        audioBase64: base64Audio || undefined,
        duration: durationSeconds,
        size: wavFile.length,
        chunks: chunks.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating audio:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate audio' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
