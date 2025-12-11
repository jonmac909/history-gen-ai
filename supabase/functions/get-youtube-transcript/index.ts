import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

// Use different User-Agent strings to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

interface TranscriptResponse {
  text: string;
  duration: number;
  offset: number;
}

function extractVideoId(urlOrId: string): string | null {
  if (urlOrId.length === 11 && /^[a-zA-Z0-9_-]+$/.test(urlOrId)) {
    return urlOrId;
  }
  const match = urlOrId.match(RE_YOUTUBE);
  return match ? match[1] : null;
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/\n/g, ' ')
    .trim();
}

async function fetchTranscript(videoId: string, lang?: string): Promise<{ title: string; segments: TranscriptResponse[]; language: string }> {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  
  console.log(`Fetching video page for: ${videoId}`);
  
  const videoPageResponse = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        'Accept-Language': lang || 'en-US,en;q=0.9',
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    }
  );

  if (!videoPageResponse.ok) {
    throw new Error(`Failed to fetch video page: ${videoPageResponse.status}`);
  }

  const videoPageBody = await videoPageResponse.text();
  console.log(`Video page length: ${videoPageBody.length}`);

  // Extract title
  const titleMatch = videoPageBody.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(' - YouTube', '')) : 'Unknown Title';
  console.log(`Video title: ${title}`);

  // Check for captcha/bot detection
  if (videoPageBody.includes('class="g-recaptcha"')) {
    throw new Error('YouTube is requiring captcha verification. Please try again later.');
  }

  // Check if video is available
  if (!videoPageBody.includes('"playabilityStatus":')) {
    throw new Error('Video is unavailable');
  }

  // Split by "captions": to find the captions data
  const splittedHTML = videoPageBody.split('"captions":');
  console.log(`Found ${splittedHTML.length - 1} captions sections`);

  if (splittedHTML.length <= 1) {
    throw new Error('Transcript is disabled on this video');
  }

  // Parse the captions JSON
  let captions: any;
  try {
    const captionsJson = splittedHTML[1].split(',"videoDetails')[0].replace('\n', '');
    captions = JSON.parse(captionsJson)?.playerCaptionsTracklistRenderer;
  } catch (e) {
    console.error('Failed to parse captions JSON:', e);
    throw new Error('Failed to parse captions data');
  }

  if (!captions) {
    throw new Error('Transcript is disabled on this video');
  }

  if (!captions.captionTracks || captions.captionTracks.length === 0) {
    throw new Error('No transcripts available for this video');
  }

  console.log(`Found ${captions.captionTracks.length} caption track(s)`);
  
  // Log available languages
  const availableLanguages = captions.captionTracks.map((t: any) => `${t.languageCode}${t.kind === 'asr' ? ' (auto)' : ''}`);
  console.log(`Available languages: ${availableLanguages.join(', ')}`);

  // Find the requested language or default to first available
  let selectedTrack;
  if (lang) {
    selectedTrack = captions.captionTracks.find((track: any) => track.languageCode === lang);
  }
  
  if (!selectedTrack) {
    // Prefer English manual, then English auto, then any manual, then any
    selectedTrack = captions.captionTracks.find((t: any) => t.languageCode === 'en' && t.kind !== 'asr');
    if (!selectedTrack) {
      selectedTrack = captions.captionTracks.find((t: any) => t.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captions.captionTracks.find((t: any) => t.kind !== 'asr');
    }
    if (!selectedTrack) {
      selectedTrack = captions.captionTracks[0];
    }
  }

  if (!selectedTrack?.baseUrl) {
    throw new Error('No valid caption track found');
  }

  console.log(`Using track: ${selectedTrack.languageCode} (${selectedTrack.kind || 'manual'})`);

  // Fetch the transcript XML
  const transcriptResponse = await fetch(selectedTrack.baseUrl, {
    headers: {
      'Accept-Language': lang || 'en-US,en;q=0.9',
      'User-Agent': userAgent,
    },
  });

  if (!transcriptResponse.ok) {
    throw new Error('Failed to fetch transcript data');
  }

  const transcriptBody = await transcriptResponse.text();
  console.log(`Transcript XML length: ${transcriptBody.length}`);

  // Parse the XML
  const results = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)];
  console.log(`Parsed ${results.length} segments`);

  if (results.length === 0) {
    throw new Error('Failed to parse transcript segments');
  }

  const segments: TranscriptResponse[] = results.map((result) => ({
    text: decodeHtmlEntities(result[3]),
    duration: parseFloat(result[2]),
    offset: parseFloat(result[1]),
  }));

  return {
    title,
    segments,
    language: selectedTrack.languageCode,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, lang } = await req.json();

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

    console.log(`=== Fetching transcript for video: ${videoId} ===`);

    const { title, segments, language } = await fetchTranscript(videoId, lang);
    const transcript = segments.map(s => s.text).join(' ');

    console.log(`=== Successfully fetched transcript (${transcript.length} chars) ===`);

    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        title,
        transcript,
        language,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching transcript:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        videoId: '', 
        title: '', 
        transcript: null, 
        error: errorMessage 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
