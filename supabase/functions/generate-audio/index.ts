import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_ENDPOINT_ID = "n4m8bw1kmrdd9e";
const RUNPOD_API_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

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
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio for ${wordCount} words with Chatterbox TTS...`);

    if (stream) {
      return generateWithStreaming(cleanScript, projectId, wordCount, RUNPOD_API_KEY);
    } else {
      return generateWithoutStreaming(cleanScript, projectId, wordCount, RUNPOD_API_KEY);
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

async function startTTSJob(text: string, apiKey: string): Promise<string> {
  console.log(`Starting TTS job at ${RUNPOD_API_URL}/run`);
  console.log(`Text length: ${text.length} chars`);
  
  const response = await fetch(`${RUNPOD_API_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        text: text,
        prompt: text
      }
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

async function generateWithStreaming(text: string, projectId: string, wordCount: number, apiKey: string): Promise<Response> {
  const encoder = new TextEncoder();
  
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 5,
          message: 'Starting Chatterbox TTS job...'
        })}\n\n`));

        // Start the TTS job
        const jobId = await startTTSJob(text, apiKey);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 15,
          message: 'TTS job queued, generating audio...'
        })}\n\n`));

        // Poll for completion with progress updates
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
            throw new Error(`TTS job failed: ${result.error || 'Unknown error'}`);
          }

          // Update progress (15% to 70% during generation)
          const progress = Math.min(15 + (attempt / maxAttempts) * 55, 70);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: Math.round(progress),
            message: `Generating audio (${result.status})...`
          })}\n\n`));

          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (!output) {
          throw new Error('TTS job timed out after 2 minutes');
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'progress', 
          progress: 75,
          message: 'Processing audio...'
        })}\n\n`));

        // Decode base64 audio
        const audioData = base64ToUint8Array(output.audio_base64);
        console.log(`Audio decoded: ${audioData.length} bytes, sample rate: ${output.sample_rate}`);

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

        // Estimate duration based on sample rate (mono 16-bit WAV)
        const durationSeconds = Math.round(audioData.length / (output.sample_rate * 2));

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

async function generateWithoutStreaming(text: string, projectId: string, wordCount: number, apiKey: string): Promise<Response> {
  // Start the TTS job
  const jobId = await startTTSJob(text, apiKey);
  console.log(`TTS job started with ID: ${jobId}`);

  // Poll for completion
  const output = await pollJobStatus(jobId, apiKey);
  console.log(`TTS job completed, sample rate: ${output.sample_rate}`);

  // Decode base64 audio
  const audioData = base64ToUint8Array(output.audio_base64);
  console.log(`Audio decoded: ${audioData.length} bytes`);

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

  // Estimate duration based on sample rate (mono 16-bit WAV)
  const durationSeconds = Math.round(audioData.length / (output.sample_rate * 2));

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
