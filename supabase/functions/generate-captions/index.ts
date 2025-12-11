import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Format time for SRT (HH:MM:SS,mmm)
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Split text into caption segments
function splitIntoSegments(text: string, wordsPerSegment: number = 8): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const segments: string[] = [];
  
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(' '));
  }
  
  return segments;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, audioDuration, projectId } = await req.json();
    
    if (!script) {
      return new Response(
        JSON.stringify({ error: 'Script is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating SRT captions...');

    // Clean script - remove visual cues
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Split into segments
    const segments = splitIntoSegments(cleanScript, 8);
    const totalWords = cleanScript.split(/\s+/).length;
    
    // Estimate timing (average speaking rate ~150 words per minute)
    const estimatedDuration = audioDuration || (totalWords / 150) * 60;
    const segmentDuration = estimatedDuration / segments.length;

    // Generate SRT content
    let srtContent = '';
    let currentTime = 0;

    segments.forEach((segment, index) => {
      const startTime = currentTime;
      const endTime = currentTime + segmentDuration;
      
      srtContent += `${index + 1}\n`;
      srtContent += `${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n`;
      srtContent += `${segment}\n\n`;
      
      currentTime = endTime;
    });

    console.log('Generated', segments.length, 'caption segments');

    // Upload to Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/captions.srt`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, new TextEncoder().encode(srtContent), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload captions file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    console.log('Captions uploaded successfully:', urlData.publicUrl);

    return new Response(
      JSON.stringify({ 
        success: true,
        captionsUrl: urlData.publicUrl,
        srtContent,
        segmentCount: segments.length,
        estimatedDuration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating captions:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate captions' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
