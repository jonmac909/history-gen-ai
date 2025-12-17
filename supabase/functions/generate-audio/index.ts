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

  // HuggingFace Space API endpoint
  const HF_SPACE_URL = "https://resembleai-chatterbox-turbo-demo.hf.space";
  
  if (stream) {
    const encoder = new TextEncoder();
    
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 10,
            message: 'Connecting to Chatterbox Turbo...'
          })}\n\n`));

          // Call the HuggingFace Space Gradio API
          // First, we need to get the session and then make the prediction
          const predictResponse = await fetch(`${HF_SPACE_URL}/api/predict`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fn_index: 0,
              data: [
                cleanScript,           // text input
                voiceSampleUrl,        // audio reference URL
                0.5,                   // exaggeration (default)
                0.5,                   // cfg_weight (default)
                42,                    // random seed
              ],
              session_hash: crypto.randomUUID(),
            }),
          });

          if (!predictResponse.ok) {
            const errorText = await predictResponse.text();
            console.error('Chatterbox API error:', predictResponse.status, errorText);
            
            // Try alternative API format for newer Gradio versions
            const altResponse = await fetch(`${HF_SPACE_URL}/run/predict`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                data: [
                  cleanScript,
                  voiceSampleUrl,
                  0.5,
                  0.5,
                  42,
                ],
              }),
            });
            
            if (!altResponse.ok) {
              const altError = await altResponse.text();
              console.error('Alternative API also failed:', altResponse.status, altError);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: `Chatterbox API error: ${predictResponse.status} - Service may be unavailable` 
              })}\n\n`));
              controller.close();
              return;
            }
            
            const altResult = await altResponse.json();
            await processChatterboxResult(altResult, controller, encoder, projectId, wordCount);
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 30,
            message: 'Generating audio with voice cloning...'
          })}\n\n`));

          const result = await predictResponse.json();
          await processChatterboxResult(result, controller, encoder, projectId, wordCount);

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
    const predictResponse = await fetch(`${HF_SPACE_URL}/api/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fn_index: 0,
        data: [
          cleanScript,
          voiceSampleUrl,
          0.5,
          0.5,
          42,
        ],
        session_hash: crypto.randomUUID(),
      }),
    });

    let result;
    if (!predictResponse.ok) {
      // Try alternative endpoint
      const altResponse = await fetch(`${HF_SPACE_URL}/run/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [
            cleanScript,
            voiceSampleUrl,
            0.5,
            0.5,
            42,
          ],
        }),
      });
      
      if (!altResponse.ok) {
        const errorText = await altResponse.text();
        throw new Error(`Chatterbox API error: ${altResponse.status} - ${errorText}`);
      }
      
      result = await altResponse.json();
    } else {
      result = await predictResponse.json();
    }

    // Extract audio from result
    const audioData = extractAudioFromResult(result);
    if (!audioData) {
      throw new Error('No audio data in response');
    }

    // Upload to Supabase storage
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

    // WAV at 44.1kHz 16-bit mono = 88200 bytes per second
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

async function processChatterboxResult(
  result: any, 
  controller: ReadableStreamDefaultController, 
  encoder: TextEncoder,
  projectId: string,
  wordCount: number
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
    type: 'progress', 
    progress: 70,
    message: 'Processing generated audio...'
  })}\n\n`));

  const audioData = extractAudioFromResult(result);
  if (!audioData) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
      type: 'error', 
      error: 'No audio data in response' 
    })}\n\n`));
    return;
  }

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
    return;
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  console.log('Audio uploaded:', urlData.publicUrl);

  // WAV at 44.1kHz 16-bit mono = 88200 bytes per second
  const durationSeconds = Math.round(audioData.length / 88200);
  console.log(`Audio duration: ~${durationSeconds}s`);

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
    type: 'complete', 
    audioUrl: urlData.publicUrl,
    duration: durationSeconds,
    size: audioData.length
  })}\n\n`));
}

function extractAudioFromResult(result: any): Uint8Array | null {
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
        
        // Check for file path (need to fetch)
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
          
          // Handle file object with name/url
          if (item.name || item.url || item.path) {
            console.log('Found file reference:', item);
            // This would need fetching from the HF Space file server
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
