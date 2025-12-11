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

async function fetchTranscriptFromPage(videoId: string): Promise<{ transcript: string; title: string; language: string } | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  const response = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  
  if (!response.ok) {
    console.error('Failed to fetch YouTube page:', response.status);
    return null;
  }
  
  const html = await response.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : 'Unknown Title';
  
  // Try to find ytInitialPlayerResponse
  const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  
  if (!playerResponseMatch) {
    console.log('Could not find ytInitialPlayerResponse');
    return null;
  }
  
  let playerResponse;
  try {
    playerResponse = JSON.parse(playerResponseMatch[1]);
  } catch (e) {
    console.error('Failed to parse player response:', e);
    return null;
  }
  
  // Get caption tracks
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!captionTracks || captionTracks.length === 0) {
    console.log('No caption tracks found in player response');
    return null;
  }
  
  console.log('Found', captionTracks.length, 'caption tracks');
  
  // Find English captions (prefer manual over auto-generated)
  let captionTrack = captionTracks.find((t: any) => 
    t.languageCode === 'en' && t.kind !== 'asr'
  );
  if (!captionTrack) {
    captionTrack = captionTracks.find((t: any) => t.languageCode === 'en');
  }
  if (!captionTrack) {
    captionTrack = captionTracks[0]; // Fallback to first available
  }
  
  if (!captionTrack?.baseUrl) {
    console.log('No baseUrl in caption track');
    return null;
  }
  
  console.log('Using caption track:', captionTrack.languageCode, captionTrack.kind || 'manual');
  
  // Fetch the captions XML
  const captionsResponse = await fetch(captionTrack.baseUrl);
  if (!captionsResponse.ok) {
    console.error('Failed to fetch captions:', captionsResponse.status);
    return null;
  }
  
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
               .replace(/&apos;/g, "'")
               .replace(/&#x27;/g, "'")
               .replace(/\n/g, ' ')
               .trim();
    if (text) {
      transcriptParts.push(text);
    }
  }
  
  const transcript = transcriptParts.join(' ').trim();
  
  if (!transcript) {
    console.log('Parsed transcript is empty');
    return null;
  }
  
  return {
    transcript,
    title,
    language: captionTrack.languageCode
  };
}

async function getVideoTitle(videoId: string): Promise<string> {
  try {
    const infoUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(infoUrl);
    if (response.ok) {
      const data = await response.json();
      return data.title || 'Unknown Title';
    }
  } catch (e) {
    console.error('Failed to fetch video title:', e);
  }
  return 'Unknown Title';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching transcript for video:', videoId);

    // Try to fetch transcript from page
    const result = await fetchTranscriptFromPage(videoId);
    
    if (result && result.transcript) {
      console.log('Successfully fetched transcript, length:', result.transcript.length);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          videoId,
          title: result.title,
          transcript: result.transcript,
          language: result.language
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Fallback: return error with video title
    const title = await getVideoTitle(videoId);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        videoId,
        title,
        transcript: null,
        error: 'No captions available for this video. Please try a different video with captions enabled.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching transcript:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch transcript' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
