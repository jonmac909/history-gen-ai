import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Create WAV header for PCM data
function createWavHeader(dataLength: number, sampleRate: number = 44100, channels: number = 1, bitsPerSample: number = 16): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666D7420, false); // "fmt "
  view.setUint32(16, 16, true); // Chunk size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, channels, true); // Channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, byteRate, true); // Byte rate
  view.setUint16(32, blockAlign, true); // Block align
  view.setUint16(34, bitsPerSample, true); // Bits per sample
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true); // Data size
  
  return new Uint8Array(header);
}

// Generate audio for full script via WebSocket for seamless voice continuity
async function generateAudioWebSocket(
  script: string,
  voiceId: string,
  apiKey: string
): Promise<Uint8Array> {
  // Use WebSocket API for seamless audio with continuations
  // Note: API key is passed as query parameter for WebSocket auth
  const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?cartesia_version=2025-04-16&api_key=${apiKey}`);
  
  return new Promise((resolve, reject) => {
    const audioChunks: Uint8Array[] = [];
    let contextId = crypto.randomUUID();
    
    ws.onopen = () => {
      console.log('WebSocket connected, sending transcript...');
      
      // Send the full transcript in a single context for seamless audio
      const message = {
        context_id: contextId,
        model_id: 'sonic-3',
        transcript: script,
        voice: {
          mode: 'id',
          id: voiceId,
        },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 44100,
        },
        continue: false,
      };
      
      ws.send(JSON.stringify(message));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'chunk' && data.data) {
          // Decode base64 audio chunk
          const binaryString = atob(data.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          audioChunks.push(bytes);
        } else if (data.type === 'done') {
          console.log(`WebSocket complete, received ${audioChunks.length} chunks`);
          ws.close();
          
          // Combine all PCM chunks
          const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const pcmData = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            pcmData.set(chunk, offset);
            offset += chunk.length;
          }
          
          // Wrap in WAV header
          const wavHeader = createWavHeader(totalLength);
          const wavData = new Uint8Array(wavHeader.length + pcmData.length);
          wavData.set(wavHeader, 0);
          wavData.set(pcmData, wavHeader.length);
          
          resolve(wavData);
        } else if (data.error) {
          console.error('WebSocket error:', data.error);
          reject(new Error(data.error));
        }
      } catch (e) {
        // Ignore parse errors for non-JSON messages
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(new Error('WebSocket connection failed'));
    };
    
    ws.onclose = (event) => {
      if (!event.wasClean && audioChunks.length === 0) {
        reject(new Error(`WebSocket closed unexpectedly: ${event.code}`));
      }
    };
    
    // Timeout after 5 minutes
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        reject(new Error('WebSocket timeout'));
      }
    }, 300000);
  });
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
    console.log(`Generating audio for ${wordCount} words via WebSocket...`);

    if (stream) {
      // Streaming mode with progress updates
      const encoder = new TextEncoder();
      
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress: 10, 
              message: 'Connecting to Cartesia...'
            })}\n\n`));
            
            // Generate audio via WebSocket for seamless voice
            const audioData = await generateAudioWebSocket(cleanScript, voiceId, CARTESIA_API_KEY);
            console.log(`Generated ${audioData.length} bytes of seamless audio`);
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress: 90, 
              message: 'Uploading audio file...'
            })}\n\n`));

            // Upload to storage
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);

            const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
            
            const { error: uploadError } = await supabase.storage
              .from('generated-assets')
              .upload(fileName, audioData, {
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

            // Calculate duration (44100 Hz, 16-bit mono = 88200 bytes/sec, minus 44 byte header)
            const durationSeconds = Math.round((audioData.length - 44) / 88200);
            console.log(`Audio duration: ${durationSeconds}s`);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              audioUrl: urlData.publicUrl,
              duration: durationSeconds,
              size: audioData.length
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
    const audioData = await generateAudioWebSocket(cleanScript, voiceId, CARTESIA_API_KEY);
    console.log(`Generated ${audioData.length} bytes of seamless audio`);

    // Upload
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
    
    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, audioData, {
        contentType: 'audio/wav',
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

    // Calculate duration (44100 Hz, 16-bit mono = 88200 bytes/sec, minus 44 byte header)
    const durationSeconds = Math.round((audioData.length - 44) / 88200);
    console.log(`Audio duration: ${durationSeconds}s`);

    return new Response(
      JSON.stringify({ 
        success: true,
        audioUrl: urlData.publicUrl,
        duration: durationSeconds,
        size: audioData.length,
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
