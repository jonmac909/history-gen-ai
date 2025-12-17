import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_BASE_URL = "https://7sqcxx5mmgaiws-8000.proxy.runpod.net";

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

    // Clean script - remove image prompts and markdown
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio for ${wordCount} words with RunPod TTS...`);

    if (stream) {
      return generateWithStreaming(cleanScript, projectId, wordCount);
    } else {
      return generateWithoutStreaming(cleanScript, projectId, wordCount);
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

async function generateWithStreaming(text: string, projectId: string, wordCount: number): Promise<Response> {
  const encoder = new TextEncoder();
  
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 10,
          message: 'Connecting to RunPod TTS...'
        })}\n\n`));

        // Call RunPod TTS API
        console.log(`Calling RunPod TTS: ${RUNPOD_BASE_URL}/tts`);
        const ttsResponse = await fetch(`${RUNPOD_BASE_URL}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!ttsResponse.ok) {
          const errorText = await ttsResponse.text();
          console.error('RunPod TTS error:', ttsResponse.status, errorText);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: `RunPod TTS failed: ${ttsResponse.status}` 
          })}\n\n`));
          controller.close();
          return;
        }

        const ttsResult = await ttsResponse.json();
        console.log('RunPod TTS response:', ttsResult);

        if (!ttsResult.file) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'No audio file returned from RunPod' 
          })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 50,
          message: 'Downloading generated audio...'
        })}\n\n`));

        // Download the audio from RunPod
        const audioFileName = ttsResult.file;
        const runpodAudioUrl = `${RUNPOD_BASE_URL}/outputs/${audioFileName}`;
        console.log(`Downloading audio from: ${runpodAudioUrl}`);

        const audioResponse = await fetch(runpodAudioUrl);
        if (!audioResponse.ok) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: `Failed to download audio: ${audioResponse.status}` 
          })}\n\n`));
          controller.close();
          return;
        }

        const audioArrayBuffer = await audioResponse.arrayBuffer();
        const audioData = new Uint8Array(audioArrayBuffer);
        console.log(`Audio downloaded: ${audioData.length} bytes`);

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

        const durationSeconds = Math.round(audioData.length / 88200);

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

async function generateWithoutStreaming(text: string, projectId: string, wordCount: number): Promise<Response> {
  // Call RunPod TTS API
  console.log(`Calling RunPod TTS: ${RUNPOD_BASE_URL}/tts`);
  const ttsResponse = await fetch(`${RUNPOD_BASE_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!ttsResponse.ok) {
    const errorText = await ttsResponse.text();
    console.error('RunPod TTS error:', ttsResponse.status, errorText);
    throw new Error(`RunPod TTS failed: ${ttsResponse.status}`);
  }

  const ttsResult = await ttsResponse.json();
  console.log('RunPod TTS response:', ttsResult);

  if (!ttsResult.file) {
    throw new Error('No audio file returned from RunPod');
  }

  // Download the audio from RunPod
  const audioFileName = ttsResult.file;
  const runpodAudioUrl = `${RUNPOD_BASE_URL}/outputs/${audioFileName}`;
  console.log(`Downloading audio from: ${runpodAudioUrl}`);

  const audioResponse = await fetch(runpodAudioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`);
  }

  const audioArrayBuffer = await audioResponse.arrayBuffer();
  const audioData = new Uint8Array(audioArrayBuffer);
  console.log(`Audio downloaded: ${audioData.length} bytes`);

  // Upload to Supabase Storage
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
    throw new Error('Failed to upload audio');
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  const durationSeconds = Math.round(audioData.length / 88200);

  return new Response(
    JSON.stringify({
      success: true,
      audioUrl: urlData.publicUrl,
      duration: durationSeconds,
      wordCount,
      size: audioData.length
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
