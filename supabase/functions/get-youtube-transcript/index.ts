import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching transcript for video:', videoId);

    // Try to get transcript using YouTube's timedtext API
    const transcriptUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageResponse = await fetch(transcriptUrl);
    const pageHtml = await pageResponse.text();

    // Extract captions track URL from the page
    const captionTrackMatch = pageHtml.match(/"captionTracks":\s*\[(.*?)\]/);
    
    if (!captionTrackMatch) {
      // Fallback: Try to get video info for title at least
      const videoInfoUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const infoResponse = await fetch(videoInfoUrl);
      
      if (infoResponse.ok) {
        const videoInfo = await infoResponse.json();
        return new Response(
          JSON.stringify({ 
            success: true,
            videoId,
            title: videoInfo.title,
            transcript: null,
            message: 'No captions available for this video. Please provide a script manually or try a different video.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Could not fetch video information' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse caption tracks
    const captionTracksJson = `[${captionTrackMatch[1]}]`;
    let captionTracks;
    try {
      captionTracks = JSON.parse(captionTracksJson);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Failed to parse caption tracks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find English captions (prefer manual over auto-generated)
    let captionTrack = captionTracks.find((t: any) => 
      t.languageCode === 'en' && !t.kind?.includes('asr')
    );
    if (!captionTrack) {
      captionTrack = captionTracks.find((t: any) => t.languageCode === 'en');
    }
    if (!captionTrack) {
      captionTrack = captionTracks[0]; // Fallback to first available
    }

    if (!captionTrack?.baseUrl) {
      return new Response(
        JSON.stringify({ error: 'No caption track found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the actual captions
    const captionsResponse = await fetch(captionTrack.baseUrl);
    const captionsXml = await captionsResponse.text();

    // Parse XML to extract text
    const textMatches = captionsXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
    const transcriptParts: string[] = [];
    
    for (const match of textMatches) {
      let text = match[1];
      // Decode HTML entities
      text = text.replace(/&amp;/g, '&')
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&quot;/g, '"')
                 .replace(/&#39;/g, "'")
                 .replace(/\n/g, ' ');
      transcriptParts.push(text);
    }

    const transcript = transcriptParts.join(' ').trim();

    // Get video title
    const titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : 'Unknown Title';

    console.log('Successfully fetched transcript, length:', transcript.length);

    return new Response(
      JSON.stringify({ 
        success: true,
        videoId,
        title,
        transcript,
        language: captionTrack.languageCode
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching transcript:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to fetch transcript' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
