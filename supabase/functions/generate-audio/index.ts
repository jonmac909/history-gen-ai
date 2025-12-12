import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Split script into smaller chunks to avoid timeout
function splitScriptIntoChunks(script: string, maxChunkWords: number = 800): string[] {
  const chunks: string[] = [];
  const sections = script.split(/\n\n+/);
  let currentChunk = "";
  let currentWordCount = 0;
  
  for (const section of sections) {
    const sectionWords = section.split(/\s+/).filter(Boolean).length;
    
    if (currentWordCount + sectionWords > maxChunkWords && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = section;
      currentWordCount = sectionWords;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + section;
      currentWordCount += sectionWords;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Generate audio using bytes endpoint (faster than SSE)
async function generateChunkAudioBytes(
  chunk: string, 
  voiceId: string, 
  apiKey: string
): Promise<Uint8Array> {
  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
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
        container: 'mp3',
        bit_rate: 128000,
        sample_rate: 44100,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Cartesia bytes error:', response.status, errorText);
    throw new Error(`Cartesia API error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Simple MP3 concatenation (works for constant bitrate MP3s)
function concatenateMp3Chunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, voiceId, projectId, stream } = await req.json();
    
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

    // Clean script
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio for ${wordCount} words...`);

    // Split into smaller chunks (800 words max for faster processing)
    const chunks = splitScriptIntoChunks(cleanScript, 800);
    console.log(`Split into ${chunks.length} chunks`);

    if (stream) {
      // Streaming mode - process chunks in PARALLEL batches for speed
      const encoder = new TextEncoder();
      const BATCH_SIZE = 4; // Process 4 chunks at a time
      
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            const audioChunks: (Uint8Array | null)[] = new Array(chunks.length).fill(null);
            let completedChunks = 0;
            
            // Process in parallel batches
            for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
              const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
              const batchIndices = [];
              
              for (let i = batchStart; i < batchEnd; i++) {
                batchIndices.push(i);
              }
              
              console.log(`Processing batch: chunks ${batchStart + 1}-${batchEnd} of ${chunks.length}`);
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                progress: Math.round((batchStart / chunks.length) * 100), 
                currentChunk: batchStart + 1, 
                totalChunks: chunks.length,
                message: `Generating audio (batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)})...`
              })}\n\n`));
              
              // Process batch in parallel
              const batchPromises = batchIndices.map(async (i) => {
                const chunkAudio = await generateChunkAudioBytes(
                  chunks[i], 
                  voiceId, 
                  CARTESIA_API_KEY
                );
                audioChunks[i] = chunkAudio;
                completedChunks++;
                return { index: i, size: chunkAudio.length };
              });
              
              const results = await Promise.all(batchPromises);
              console.log(`Batch complete: ${results.map(r => `chunk ${r.index + 1} (${r.size} bytes)`).join(', ')}`);
              
              // Send progress after batch
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                progress: Math.round((completedChunks / chunks.length) * 100), 
                currentChunk: completedChunks, 
                totalChunks: chunks.length,
                message: `Generated ${completedChunks}/${chunks.length} audio segments`
              })}\n\n`));
            }

            // Combine MP3 chunks (filter nulls just in case)
            const validChunks = audioChunks.filter((c): c is Uint8Array => c !== null);
            const combinedMp3 = concatenateMp3Chunks(validChunks);
            console.log(`Combined MP3: ${combinedMp3.length} bytes from ${validChunks.length} chunks`);

            // Upload to storage
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);

            const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress: 95, 
              message: 'Uploading audio file...'
            })}\n\n`));
            
            const { error: uploadError } = await supabase.storage
              .from('generated-assets')
              .upload(fileName, combinedMp3, {
                contentType: 'audio/mpeg',
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

            // Calculate actual duration from MP3 file size
            // Formula: duration = (file_size_bytes * 8) / bit_rate
            // Our MP3 is 128kbps = 128000 bits per second
            const bitRate = 128000;
            const durationSeconds = Math.round((combinedMp3.length * 8) / bitRate);
            console.log(`Audio duration: ${durationSeconds}s (calculated from ${combinedMp3.length} bytes @ ${bitRate}bps)`);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              audioUrl: urlData.publicUrl,
              duration: durationSeconds,
              size: combinedMp3.length,
              totalChunks: chunks.length
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

    // Non-streaming mode
    const audioChunks: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const chunkAudio = await generateChunkAudioBytes(
        chunks[i], 
        voiceId, 
        CARTESIA_API_KEY
      );
      audioChunks.push(chunkAudio);
    }

    const combinedMp3 = concatenateMp3Chunks(audioChunks);
    console.log(`Combined MP3: ${combinedMp3.length} bytes`);

    // Upload
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;
    
    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, combinedMp3, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload audio' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    // Calculate actual duration from MP3 file size (128kbps)
    const bitRate = 128000;
    const durationSeconds = Math.round((combinedMp3.length * 8) / bitRate);
    console.log(`Audio duration: ${durationSeconds}s (from ${combinedMp3.length} bytes)`);

    return new Response(
      JSON.stringify({ 
        success: true,
        audioUrl: urlData.publicUrl,
        duration: durationSeconds,
        size: combinedMp3.length,
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
