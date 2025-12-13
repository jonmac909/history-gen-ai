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
    const { script, voiceId, projectId, stream, referenceAudioUrl, ttsEngine } = await req.json();
    
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
    
    // Determine which TTS engine to use
    const useOpenVoice = ttsEngine === 'openvoice' || referenceAudioUrl;
    
    if (useOpenVoice) {
      return await generateWithOpenVoice(cleanScript, referenceAudioUrl, projectId, stream, wordCount);
    } else {
      return await generateWithElevenLabs(cleanScript, voiceId, projectId, stream, wordCount);
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

async function generateWithOpenVoice(
  cleanScript: string, 
  referenceAudioUrl: string, 
  projectId: string, 
  stream: boolean,
  wordCount: number
) {
  const SEGMIND_API_KEY = Deno.env.get('SEGMIND_API_KEY');
  if (!SEGMIND_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Segmind API key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Use Segmind's sample audio as default - this URL is known to work with their API
  const defaultVoiceUrl = 'https://segmind-sd-models.s3.amazonaws.com/display_images/openvoice-ip.mp3';
  const voiceUrl = referenceAudioUrl || defaultVoiceUrl;
  
  console.log(`Generating audio with OpenVoice for ${wordCount} words...`);
  console.log(`Input audio: ${voiceUrl}`);

  if (stream) {
    const encoder = new TextEncoder();
    
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 10,
            message: 'Connecting to OpenVoice...'
          })}\n\n`));

          // Segmind OpenVoice API - split long text into chunks if needed
          const maxChars = 500; // Segmind has character limits
          const textChunks = splitTextIntoChunks(cleanScript, maxChars);
          const audioChunks: Uint8Array[] = [];
          
          for (let i = 0; i < textChunks.length; i++) {
            const chunk = textChunks[i];
            const progress = 10 + Math.floor((i / textChunks.length) * 70);
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress,
              message: `Generating chunk ${i + 1}/${textChunks.length}...`
            })}\n\n`));

            const response = await fetch('https://api.segmind.com/v1/openvoice', {
              method: 'POST',
              headers: {
                'x-api-key': SEGMIND_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: chunk,
                input_audio: voiceUrl,
                language: 'EN_NEWEST',
                speed: 1.0,
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('OpenVoice error:', response.status, errorText);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: `OpenVoice API error: ${response.status} - ${errorText}` 
              })}\n\n`));
              controller.close();
              return;
            }

            const audioBuffer = await response.arrayBuffer();
            audioChunks.push(new Uint8Array(audioBuffer));
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 85,
            message: 'Processing audio...'
          })}\n\n`));

          // Combine all audio chunks
          const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const audioData = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            audioData.set(chunk, offset);
            offset += chunk.length;
          }

          console.log(`Audio generated: ${audioData.length} bytes`);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 90,
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

          const durationSeconds = Math.round(audioData.length / 32000); // WAV estimate
          console.log(`Audio duration: ~${durationSeconds}s`);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'complete', 
            audioUrl: urlData.publicUrl,
            duration: durationSeconds,
            size: audioData.length
          })}\n\n`));

        } catch (error) {
          console.error('OpenVoice error:', error);
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

  // Non-streaming OpenVoice
  const maxChars = 500;
  const textChunks = splitTextIntoChunks(cleanScript, maxChars);
  const audioChunks: Uint8Array[] = [];
  
  for (const chunk of textChunks) {
    const response = await fetch('https://api.segmind.com/v1/openvoice', {
      method: 'POST',
      headers: {
        'x-api-key': SEGMIND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: chunk,
        input_audio: voiceUrl,
        language: 'EN_NEWEST',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenVoice error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `OpenVoice API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    audioChunks.push(new Uint8Array(audioBuffer));
  }

  // Combine chunks
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const audioData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    audioData.set(chunk, offset);
    offset += chunk.length;
  }

  console.log(`Audio generated: ${audioData.length} bytes`);

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
      JSON.stringify({ error: 'Failed to upload audio', details: uploadError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  const durationSeconds = Math.round(audioData.length / 32000);

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

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxChars) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

async function generateWithElevenLabs(
  cleanScript: string, 
  voiceId: string, 
  projectId: string, 
  stream: boolean,
  wordCount: number
) {
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  if (!ELEVENLABS_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ElevenLabs API key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const selectedVoiceId = voiceId || '3GntEbfzhYH3X9VCuIHy';
  
  console.log(`Generating audio for ${wordCount} words with ElevenLabs Flash v2.5...`);
  console.log(`Using voice ID: ${selectedVoiceId}`);

  if (stream) {
    const encoder = new TextEncoder();
    
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 10,
            message: 'Connecting to ElevenLabs...'
          })}\n\n`));

          const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream`,
            {
              method: 'POST',
              headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: cleanScript,
                model_id: 'eleven_flash_v2_5',
                output_format: 'mp3_44100_128',
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.75,
                  style: 0.5,
                  use_speaker_boost: true,
                },
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs error:', response.status, errorText);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: `ElevenLabs API error: ${response.status} - ${errorText}` 
            })}\n\n`));
            controller.close();
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            progress: 30,
            message: 'Generating audio...'
          })}\n\n`));

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('Failed to get response reader');
          }

          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.length;
            
            const progress = Math.min(30 + Math.floor(totalBytes / 10000), 80);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress,
              message: `Receiving audio... (${Math.round(totalBytes / 1024)}KB)`
            })}\n\n`));
          }

          const audioData = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            audioData.set(chunk, offset);
            offset += chunk.length;
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

          const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;
          
          const { error: uploadError } = await supabase.storage
            .from('generated-assets')
            .upload(fileName, audioData, {
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

          const durationSeconds = Math.round(audioData.length / 16000);
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

  // Non-streaming ElevenLabs
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanScript,
        model_id: 'eleven_flash_v2_5',
        output_format: 'mp3_44100_128',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('ElevenLabs error:', response.status, errorText);
    return new Response(
      JSON.stringify({ error: `ElevenLabs API error: ${response.status}`, details: errorText }),
      { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const audioBuffer = await response.arrayBuffer();
  const audioData = new Uint8Array(audioBuffer);

  console.log(`Audio generated: ${audioData.length} bytes`);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;
  
  const { error: uploadError } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, audioData, {
      contentType: 'audio/mpeg',
      upsert: true,
    });

  if (uploadError) {
    console.error('Upload error:', uploadError);
    return new Response(
      JSON.stringify({ error: 'Failed to upload audio', details: uploadError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  const durationSeconds = Math.round(audioData.length / 16000);

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
