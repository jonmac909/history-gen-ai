import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/\n/g, ' ')
    .trim();
}

async function fetchTranscript(videoId: string): Promise<{ transcript: string; title: string; language: string } | null> {
  // First, fetch the video page to get necessary tokens
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  console.log('Fetching YouTube page...');
  
  const pageResponse = await fetch(watchUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
    }
  });
  
  if (!pageResponse.ok) {
    console.error('Failed to fetch YouTube page:', pageResponse.status);
    return null;
  }
  
  const html = await pageResponse.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(' - YouTube', '')) : 'Unknown Title';
  
  console.log('Video title:', title);
  
  // Try multiple patterns to find caption data
  // Pattern 1: Look for captionTracks in ytInitialPlayerResponse
  let captionTracksMatch = html.match(/"captionTracks"\s*:\s*(\[.*?\])\s*,\s*"audioTracks"/s);
  
  if (!captionTracksMatch) {
    // Pattern 2: Alternative pattern
    captionTracksMatch = html.match(/"captionTracks"\s*:\s*(\[.*?\])\s*(?:,|\})/s);
  }
  
  if (!captionTracksMatch) {
    // Pattern 3: Look in a different structure
    const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (playerResponseMatch) {
      try {
        // Try to find captions in the parsed response
        const jsonStr = playerResponseMatch[1];
        const captionsMatch = jsonStr.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])/);
        if (captionsMatch) {
          captionTracksMatch = ['', captionsMatch[1]];
        }
      } catch (e) {
        console.error('Failed to parse player response:', e);
      }
    }
  }
  
  if (!captionTracksMatch || !captionTracksMatch[1]) {
    console.log('No caption tracks found in page');
    
    // Check if video has captions disabled or is unavailable
    if (html.includes('"playabilityStatus":{"status":"ERROR"')) {
      console.log('Video is unavailable');
    }
    
    return null;
  }
  
  console.log('Found caption tracks data');
  
  let captionTracks;
  try {
    // Clean up the JSON string
    let tracksJson = captionTracksMatch[1];
    // Fix any trailing issues
    if (!tracksJson.endsWith(']')) {
      const lastBracket = tracksJson.lastIndexOf(']');
      if (lastBracket > 0) {
        tracksJson = tracksJson.substring(0, lastBracket + 1);
      }
    }
    captionTracks = JSON.parse(tracksJson);
  } catch (e) {
    console.error('Failed to parse caption tracks:', e);
    console.log('Raw tracks string:', captionTracksMatch[1].substring(0, 200));
    return null;
  }
  
  if (!captionTracks || captionTracks.length === 0) {
    console.log('Caption tracks array is empty');
    return null;
  }
  
  console.log('Found', captionTracks.length, 'caption track(s)');
  
  // Find the best caption track (prefer English manual, then English auto, then any)
  let selectedTrack = captionTracks.find((t: any) => 
    t.languageCode === 'en' && t.kind !== 'asr'
  );
  
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t: any) => t.languageCode === 'en');
  }
  
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t: any) => t.kind !== 'asr');
  }
  
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
  }
  
  if (!selectedTrack?.baseUrl) {
    console.log('No valid caption track with baseUrl found');
    return null;
  }
  
  console.log('Using caption track:', selectedTrack.languageCode, selectedTrack.kind || 'manual');
  
  // Fetch the captions XML
  const captionsResponse = await fetch(selectedTrack.baseUrl, {
    headers: {
      'User-Agent': USER_AGENT,
    }
  });
  
  if (!captionsResponse.ok) {
    console.error('Failed to fetch captions XML:', captionsResponse.status);
    return null;
  }
  
  const captionsXml = await captionsResponse.text();
  console.log('Fetched captions XML, length:', captionsXml.length);
  
  // Parse XML to extract text
  const textMatches = [...captionsXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
  
  if (textMatches.length === 0) {
    console.log('No text elements found in captions XML');
    return null;
  }
  
  console.log('Found', textMatches.length, 'text segments');
  
  const transcriptParts: string[] = [];
  
  for (const match of textMatches) {
    const text = decodeHtmlEntities(match[1]);
    if (text) {
      transcriptParts.push(text);
    }
  }
  
  const transcript = transcriptParts.join(' ').replace(/\s+/g, ' ').trim();
  
  if (!transcript) {
    console.log('Transcript is empty after parsing');
    return null;
  }
  
  console.log('Final transcript length:', transcript.length, 'characters');
  
  return {
    transcript,
    title,
    language: selectedTrack.languageCode
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

    console.log('=== Starting transcript fetch for video:', videoId, '===');

    const result = await fetchTranscript(videoId);
    
    if (result && result.transcript) {
      console.log('=== Successfully fetched transcript ===');
      
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
    console.log('=== Failed to fetch transcript, returning error ===');
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
    console.error('Error in get-youtube-transcript:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch transcript' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
