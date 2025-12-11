import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    .replace(/\\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

// Extract captions directly from the initial player response in HTML
function extractCaptionsFromHtml(html: string): any {
  // Try to find ytInitialPlayerResponse
  const playerResponseMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});(?:\s*var|\s*<\/script>)/s);
  if (playerResponseMatch) {
    try {
      const playerResponse = JSON.parse(playerResponseMatch[1]);
      console.log('Found ytInitialPlayerResponse');
      
      const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer;
      if (captions?.captionTracks?.length > 0) {
        console.log(`Found ${captions.captionTracks.length} caption tracks in ytInitialPlayerResponse`);
        return captions;
      }
    } catch (e) {
      console.log('Failed to parse ytInitialPlayerResponse:', e);
    }
  }
  
  // Try splitting by "captions": approach
  const captionsSplit = html.split('"captions":');
  if (captionsSplit.length > 1) {
    for (let i = 1; i < captionsSplit.length; i++) {
      try {
        // Find the end of the captions object
        let jsonStr = captionsSplit[i];
        
        // Try to extract just the playerCaptionsTracklistRenderer
        const endMarkers = [',"videoDetails"', ',"trackingParams"', ',"attestation"', ',"messages"'];
        for (const marker of endMarkers) {
          const idx = jsonStr.indexOf(marker);
          if (idx !== -1) {
            jsonStr = jsonStr.substring(0, idx);
            break;
          }
        }
        
        const parsed = JSON.parse(jsonStr);
        const captions = parsed?.playerCaptionsTracklistRenderer;
        if (captions?.captionTracks?.length > 0) {
          console.log(`Found ${captions.captionTracks.length} caption tracks via split method`);
          return captions;
        }
      } catch (e) {
        // Continue trying
      }
    }
  }
  
  // Try regex for captionTracks directly
  const tracksMatch = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
  if (tracksMatch) {
    try {
      const tracks = JSON.parse(tracksMatch[1]);
      if (tracks.length > 0) {
        console.log(`Found ${tracks.length} caption tracks via regex`);
        return { captionTracks: tracks };
      }
    } catch (e) {
      console.log('Failed to parse captionTracks regex match');
    }
  }
  
  return null;
}

async function fetchVideoPage(videoId: string): Promise<string> {
  console.log(`Fetching video page for: ${videoId}`);
  
  // Use cookies to bypass consent
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': 'CONSENT=YES+cb; YSC=DwKYllHNwuw',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch video page: ${response.status}`);
  }
  
  const html = await response.text();
  console.log(`Video page length: ${html.length}`);
  
  return html;
}

function selectBestTrack(tracks: any[], preferredLang?: string): any {
  const available = tracks.map((t: any) => {
    const lang = t.languageCode || t.vssId?.replace(/^\./, '').replace(/^a\./, '') || 'unknown';
    const isAuto = t.kind === 'asr' || t.vssId?.startsWith('a.');
    return `${lang}${isAuto ? ' (auto)' : ''}`;
  });
  console.log(`Available languages: ${available.join(', ')}`);
  
  // Try preferred language
  if (preferredLang) {
    const preferred = tracks.find((t: any) => 
      t.languageCode === preferredLang || t.vssId?.includes(preferredLang)
    );
    if (preferred) return preferred;
  }
  
  // Priority: manual English > auto English > any manual > any
  let selected = tracks.find((t: any) => 
    (t.languageCode === 'en' || t.vssId === '.en') && t.kind !== 'asr' && !t.vssId?.startsWith('a.')
  );
  if (!selected) {
    selected = tracks.find((t: any) => 
      t.languageCode === 'en' || t.vssId?.includes('en')
    );
  }
  if (!selected) {
    selected = tracks.find((t: any) => 
      t.kind !== 'asr' && !t.vssId?.startsWith('a.')
    );
  }
  if (!selected) {
    selected = tracks[0];
  }
  
  const lang = selected.languageCode || selected.vssId || 'unknown';
  console.log(`Selected track: ${lang}`);
  return selected;
}

async function fetchTranscriptXml(baseUrl: string): Promise<string> {
  // Clean up the URL
  let url = baseUrl.replace(/\\u0026/g, '&').replace('&fmt=srv3', '');
  
  console.log(`Fetching transcript from URL`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }
  
  const xml = await response.text();
  console.log(`Transcript XML length: ${xml.length}`);
  return xml;
}

function parseTranscriptXml(xml: string): TranscriptSnippet[] {
  const snippets: TranscriptSnippet[] = [];
  
  // Match <text> elements with various attribute orders
  const regex = /<text[^>]*\bstart="([^"]*)"[^>]*(?:\bdur="([^"]*)")?[^>]*>([^]*?)<\/text>/g;
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const duration = parseFloat(match[2]) || 0;
    let text = match[3];
    
    // Decode and clean up
    text = stripHtmlTags(decodeHtmlEntities(text)).trim();
    
    if (text) {
      snippets.push({ text, start, duration });
    }
  }
  
  // If the first regex didn't work, try a simpler pattern
  if (snippets.length === 0) {
    const simpleRegex = /<text[^>]+>([^<]+)<\/text>/g;
    while ((match = simpleRegex.exec(xml)) !== null) {
      const text = stripHtmlTags(decodeHtmlEntities(match[1])).trim();
      if (text) {
        snippets.push({ text, start: 0, duration: 0 });
      }
    }
  }
  
  console.log(`Parsed ${snippets.length} transcript snippets`);
  return snippets;
}

async function getTranscript(videoId: string, lang?: string): Promise<{
  title: string;
  transcript: string;
  language: string;
}> {
  // Fetch the video page
  const html = await fetchVideoPage(videoId);
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch 
    ? decodeHtmlEntities(titleMatch[1].replace(' - YouTube', ''))
    : 'Unknown Title';
  console.log(`Video title: ${title}`);
  
  // Check for bot detection
  if (html.includes('class="g-recaptcha"')) {
    throw new Error('YouTube is requiring captcha verification. Please try again later.');
  }
  
  // Extract captions from HTML
  const captions = extractCaptionsFromHtml(html);
  
  if (!captions || !captions.captionTracks || captions.captionTracks.length === 0) {
    // Log some debug info
    const hasPlayerResponse = html.includes('ytInitialPlayerResponse');
    const hasCaptions = html.includes('"captions"');
    const hasCaptionTracks = html.includes('"captionTracks"');
    console.log(`Debug - hasPlayerResponse: ${hasPlayerResponse}, hasCaptions: ${hasCaptions}, hasCaptionTracks: ${hasCaptionTracks}`);
    
    // Check if transcripts are explicitly disabled
    if (html.includes('"playabilityStatus"') && !hasCaptionTracks) {
      throw new Error('No transcript available for this video');
    }
    
    throw new Error('Could not find caption tracks in video page');
  }
  
  // Select best track
  const track = selectBestTrack(captions.captionTracks, lang);
  
  if (!track.baseUrl) {
    throw new Error('Caption track has no URL');
  }
  
  // Fetch and parse transcript
  const xml = await fetchTranscriptXml(track.baseUrl);
  const snippets = parseTranscriptXml(xml);
  
  if (snippets.length === 0) {
    throw new Error('Failed to parse transcript content');
  }
  
  const transcript = snippets.map(s => s.text).join(' ');
  const language = track.languageCode || track.vssId?.replace(/^\./, '').replace(/^a\./, '') || 'en';
  
  return { title, transcript, language };
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

    console.log(`=== Success: ${result.transcript.length} chars ===`);

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
    console.error('Error:', error);
    
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
