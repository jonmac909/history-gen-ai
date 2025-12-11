import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Generating audio with Cartesia...');

    // Clean script - remove visual cues in brackets for audio
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Cartesia TTS API
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': CARTESIA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-2',
        transcript: cleanScript,
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
      console.error('Cartesia API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Cartesia API error: ${response.status} - ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    console.log('Audio generated, size:', audioBuffer.byteLength);

    // Upload to Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/voiceover.mp3`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
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

    // Also return base64 for immediate playback
    const base64Audio = base64Encode(audioBuffer);

    return new Response(
      JSON.stringify({ 
        success: true,
        audioUrl: urlData.publicUrl,
        audioBase64: base64Audio,
        duration: Math.round(audioBuffer.byteLength / (128000 / 8)), // Approximate duration in seconds
        size: audioBuffer.byteLength,
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
