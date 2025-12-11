import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WATCH_URL = "https://www.youtube.com/watch?v=";
const INNERTUBE_API_URL = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: "20.10.38"
  }
};

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;

interface TranscriptSnippet {
  text: string;
  start: number;
  duration: number;
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

// Strip HTML tags from text
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

async function fetchVideoHtml(videoId: string): Promise<string> {
  console.log(`Fetching video HTML for: ${videoId}`);
  const response = await fetch(`${WATCH_URL}${videoId}`, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch video page: ${response.status}`);
  }
  
  const html = await response.text();
  console.log(`Fetched HTML length: ${html.length}`);
  
  // Check for consent page
  if (html.includes('action="https://consent.youtube.com/s"')) {
    console.log('Consent page detected, but continuing with InnerTube API');
  }
  
  return decodeHtmlEntities(html);
}

function extractInnertubeApiKey(html: string): string {
  const match = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
  if (match && match[1]) {
    console.log(`Found InnerTube API key: ${match[1]}`);
    return match[1];
  }
  
  // Check for captcha/bot detection
  if (html.includes('class="g-recaptcha"')) {
    throw new Error('IP blocked: YouTube is requiring captcha verification');
  }
  
  throw new Error('Could not extract InnerTube API key from page');
}

async function fetchInnertubeData(videoId: string, apiKey: string): Promise<any> {
  console.log(`Fetching InnerTube data for video: ${videoId}`);
  
  const response = await fetch(`${INNERTUBE_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      context: INNERTUBE_CONTEXT,
      videoId: videoId,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`InnerTube API request failed: ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`InnerTube response received, has captions: ${!!data.captions}`);
  return data;
}

function extractCaptionsJson(innertubeData: any, videoId: string): any {
  // Check playability status
  const playabilityStatus = innertubeData.playabilityStatus;
  if (playabilityStatus) {
    const status = playabilityStatus.status;
    const reason = playabilityStatus.reason;
    
    console.log(`Playability status: ${status}, reason: ${reason || 'none'}`);
    
    if (status === 'ERROR') {
      throw new Error(`Video unavailable: ${reason || 'Unknown error'}`);
    }
    if (status === 'LOGIN_REQUIRED') {
      if (reason === "Sign in to confirm you're not a bot") {
        throw new Error('Request blocked: YouTube detected bot-like behavior');
      }
      if (reason?.includes('inappropriate')) {
        throw new Error('Video is age-restricted');
      }
    }
  }
  
  const captionsJson = innertubeData.captions?.playerCaptionsTracklistRenderer;
  
  if (!captionsJson) {
    console.log('No captions renderer found in response');
    throw new Error('Transcripts are disabled on this video');
  }
  
  if (!captionsJson.captionTracks || captionsJson.captionTracks.length === 0) {
    console.log('No caption tracks found');
    throw new Error('No transcripts available for this video');
  }
  
  console.log(`Found ${captionsJson.captionTracks.length} caption track(s)`);
  return captionsJson;
}

function selectCaptionTrack(captionsJson: any, preferredLang?: string): any {
  const tracks = captionsJson.captionTracks;
  
  // Log available tracks
  const available = tracks.map((t: any) => 
    `${t.languageCode}${t.kind === 'asr' ? ' (auto)' : ''}`
  );
  console.log(`Available languages: ${available.join(', ')}`);
  
  // Try to find preferred language first
  if (preferredLang) {
    const preferred = tracks.find((t: any) => t.languageCode === preferredLang);
    if (preferred) {
      console.log(`Using preferred language: ${preferredLang}`);
      return preferred;
    }
  }
  
  // Priority: manual English > auto English > any manual > any auto
  let selected = tracks.find((t: any) => t.languageCode === 'en' && t.kind !== 'asr');
  if (!selected) {
    selected = tracks.find((t: any) => t.languageCode === 'en');
  }
  if (!selected) {
    selected = tracks.find((t: any) => t.kind !== 'asr');
  }
  if (!selected) {
    selected = tracks[0];
  }
  
  console.log(`Selected track: ${selected.languageCode} (${selected.kind || 'manual'})`);
  return selected;
}

async function fetchTranscriptXml(baseUrl: string): Promise<string> {
  // Remove srv3 format if present (we want the default XML format)
  const url = baseUrl.replace('&fmt=srv3', '');
  
  console.log(`Fetching transcript XML from: ${url.substring(0, 100)}...`);
  
  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }
  
  const xml = await response.text();
  console.log(`Fetched transcript XML length: ${xml.length}`);
  return xml;
}

function parseTranscriptXml(xml: string): TranscriptSnippet[] {
  const snippets: TranscriptSnippet[] = [];
  
  // Parse <text start="..." dur="...">content</text>
  const regex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/text>/g;
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const duration = parseFloat(match[2]) || 0;
    const rawText = match[3];
    
    // Decode HTML entities and strip HTML tags
    const text = stripHtmlTags(decodeHtmlEntities(rawText)).trim();
    
    if (text) {
      snippets.push({ text, start, duration });
    }
  }
  
  console.log(`Parsed ${snippets.length} transcript snippets`);
  return snippets;
}

async function getTranscript(videoId: string, lang?: string): Promise<{
  title: string;
  transcript: string;
  language: string;
  snippets: TranscriptSnippet[];
}> {
  // Step 1: Fetch video HTML to get the InnerTube API key
  const html = await fetchVideoHtml(videoId);
  
  // Extract title from HTML
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch 
    ? decodeHtmlEntities(titleMatch[1].replace(' - YouTube', ''))
    : 'Unknown Title';
  console.log(`Video title: ${title}`);
  
  // Step 2: Extract InnerTube API key
  const apiKey = extractInnertubeApiKey(html);
  
  // Step 3: Fetch data from InnerTube API (using ANDROID client)
  const innertubeData = await fetchInnertubeData(videoId, apiKey);
  
  // Step 4: Extract captions JSON
  const captionsJson = extractCaptionsJson(innertubeData, videoId);
  
  // Step 5: Select the best caption track
  const track = selectCaptionTrack(captionsJson, lang);
  
  // Step 6: Fetch the transcript XML
  const xml = await fetchTranscriptXml(track.baseUrl);
  
  // Step 7: Parse the XML into snippets
  const snippets = parseTranscriptXml(xml);
  
  if (snippets.length === 0) {
    throw new Error('Failed to parse transcript content');
  }
  
  // Combine all snippets into a single transcript
  const transcript = snippets.map(s => s.text).join(' ');
  
  return {
    title,
    transcript,
    language: track.languageCode,
    snippets,
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

    const result = await getTranscript(videoId, lang);

    console.log(`=== Successfully fetched transcript (${result.transcript.length} chars) ===`);

    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        title: result.title,
        transcript: result.transcript,
        language: result.language,
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
