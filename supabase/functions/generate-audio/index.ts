import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    if (!voiceSampleUrl) {
      return new Response(
        JSON.stringify({ error: 'Voice sample URL is required for voice cloning' }),
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
    
    return await generateWithChatterbox(cleanScript, voiceSampleUrl, projectId, stream, wordCount);

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

async function generateWithChatterbox(
  cleanScript: string, 
  voiceSampleUrl: string, 
  projectId: string, 
  stream: boolean,
  wordCount: number
) {
  console.log(`Generating audio for ${wordCount} words with Chatterbox Turbo...`);
  console.log(`Voice sample URL: ${voiceSampleUrl}`);

  // HuggingFace Space API endpoint - use Gradio API format
  const HF_SPACE_URL = "https://resembleai-chatterbox-turbo-demo.hf.space";
  
  const encoder = new TextEncoder();
  
  if (stream) {
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 10,
            message: 'Connecting to Chatterbox Turbo...'
          })}\n\n`));

          const audioData = await callChatterboxAPI(HF_SPACE_URL, cleanScript, voiceSampleUrl);
          
          if (!audioData) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: 'Chatterbox API failed - the HuggingFace Space may be unavailable or sleeping. Try again in a moment.' 
            })}\n\n`));
            controller.close();
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 70,
            message: 'Processing generated audio...'
          })}\n\n`));

          console.log(`Audio generated: ${audioData.length} bytes`);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 85,
            message: 'Uploading audio file...'
          })}\n\n`));

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
          console.log(`Audio duration: ~${durationSeconds}s`);

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

  // Non-streaming version
  try {
    const audioData = await callChatterboxAPI(HF_SPACE_URL, cleanScript, voiceSampleUrl);
    
    if (!audioData) {
      throw new Error('Chatterbox API failed - the HuggingFace Space may be unavailable');
    }

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

  } catch (error) {
    console.error('Chatterbox error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Audio generation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function callChatterboxAPI(baseUrl: string, text: string, voiceSampleUrl: string): Promise<Uint8Array | null> {
  // Try Gradio 4.x/5.x API format first
  const endpoints = [
    `${baseUrl}/gradio_api/call/generate`,
    `${baseUrl}/api/predict`,
    `${baseUrl}/call/generate`,
    `${baseUrl}/run/predict`,
  ];
  
  for (const endpoint of endpoints) {
    console.log(`Trying endpoint: ${endpoint}`);
    
    try {
      // For gradio_api/call endpoints, we need a two-step process
      if (endpoint.includes('gradio_api/call')) {
        // Step 1: Submit the job
        const submitResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [text, voiceSampleUrl, 0.5, 0.5, 42]
          }),
        });
        
        if (!submitResponse.ok) {
          console.log(`Submit failed: ${submitResponse.status}`);
          continue;
        }
        
        const submitResult = await submitResponse.json();
        console.log('Submit result:', JSON.stringify(submitResult).substring(0, 200));
        
        // Step 2: Get the result using event_id
        if (submitResult.event_id) {
          const resultResponse = await fetch(`${endpoint}/${submitResult.event_id}`, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' },
          });
          
          if (resultResponse.ok) {
            const resultText = await resultResponse.text();
            console.log('Result:', resultText.substring(0, 500));
            
            // Parse SSE response to get audio data
            const audioData = parseSSEResponse(resultText, baseUrl);
            if (audioData) return audioData;
          }
        }
      } else {
        // Direct API call for older Gradio versions
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fn_index: 0,
            data: [text, voiceSampleUrl, 0.5, 0.5, 42],
            session_hash: crypto.randomUUID(),
          }),
        });
        
        if (!response.ok) {
          console.log(`Endpoint failed: ${response.status}`);
          continue;
        }
        
        const result = await response.json();
        console.log('API result:', JSON.stringify(result).substring(0, 500));
        
        const audioData = extractAudioFromResult(result, baseUrl);
        if (audioData) return audioData;
      }
    } catch (error) {
      console.log(`Endpoint ${endpoint} error:`, error);
    }
  }
  
  return null;
}

async function parseSSEResponse(sseText: string, baseUrl: string): Promise<Uint8Array | null> {
  const lines = sseText.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data:')) {
      try {
        const data = JSON.parse(line.substring(5).trim());
        if (data && Array.isArray(data)) {
          const audioData = await extractAudioFromResult({ data }, baseUrl);
          if (audioData) return audioData;
        }
      } catch (e) {
        // Continue parsing
      }
    }
  }
  
  return null;
}


async function extractAudioFromResult(result: any, baseUrl: string): Promise<Uint8Array | null> {
  try {
    // Gradio returns data in different formats
    // Try to find the audio data in the response
    
    if (result.data && Array.isArray(result.data)) {
      for (const item of result.data) {
        // Check for base64 audio data
        if (typeof item === 'string' && item.startsWith('data:audio')) {
          const base64Data = item.split(',')[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes;
        }
        
        // Check for file object with path/url
        if (typeof item === 'object' && item !== null) {
          if (item.data && typeof item.data === 'string' && item.data.startsWith('data:audio')) {
            const base64Data = item.data.split(',')[1];
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
          }
          
          // Handle file reference from Gradio
          const fileUrl = item.url || item.path || item.name;
          if (fileUrl) {
            console.log('Found file reference:', fileUrl);
            // Fetch from HF Space file server
            const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${baseUrl}/file=${fileUrl}`;
            console.log('Fetching audio from:', fullUrl);
            
            const fileResponse = await fetch(fullUrl);
            if (fileResponse.ok) {
              const arrayBuffer = await fileResponse.arrayBuffer();
              return new Uint8Array(arrayBuffer);
            }
          }
        }
      }
    }
    
    console.log('Could not extract audio from result:', JSON.stringify(result).substring(0, 500));
    return null;
  } catch (error) {
    console.error('Error extracting audio:', error);
    return null;
  }
}
