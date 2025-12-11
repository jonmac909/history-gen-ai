import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

function extractVideoId(urlOrId: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
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
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/\n/g, ' ')
    .trim();
}

async function fetchTranscriptViaInnerTube(videoId: string): Promise<{ title: string; segments: TranscriptSegment[] }> {
  console.log(`Fetching transcript via InnerTube API for: ${videoId}`);
  
  // First get the video page to extract required data
  const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!watchResponse.ok) {
    throw new Error(`Failed to fetch video page: ${watchResponse.status}`);
  }

  const html = await watchResponse.text();
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(' - YouTube', '')) : '';
  console.log(`Video title: ${title}`);

  // Extract INNERTUBE_API_KEY
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  
  // Extract serializedShareEntity for the video
  const shareEntityMatch = html.match(/"serializedShareEntity":"([^"]+)"/);
  
  // Get the engagement panels to find transcript panel
  const engagementPanelMatch = html.match(/"engagementPanels":\s*(\[[\s\S]*?\])\s*,\s*"topbar"/);
  
  // Try to find transcript params
  let transcriptParams: string | null = null;
  
  // Look for showTranscriptCommand or transcript panel
  const transcriptMatch = html.match(/"showTranscriptCommand":\s*\{[^}]*"params":\s*"([^"]+)"/);
  if (transcriptMatch) {
    transcriptParams = transcriptMatch[1];
    console.log('Found transcript params via showTranscriptCommand');
  }
  
  if (!transcriptParams) {
    // Alternative: look for continuation in transcript panel
    const continuationMatch = html.match(/"continuationCommand":\s*\{[^}]*"token":\s*"([^"]+)"[^}]*\}[^}]*"commandMetadata"[^}]*"clickTrackingParams"[^}]*"showEngagementPanelEndpoint":\s*\{[^}]*"panelIdentifier":\s*"engagement-panel-searchable-transcript"/s);
    if (continuationMatch) {
      transcriptParams = continuationMatch[1];
      console.log('Found transcript params via continuation');
    }
  }

  // If we still don't have params, try fetching captions directly
  if (!transcriptParams) {
    console.log('No transcript params found, trying direct caption fetch...');
    return await fetchCaptionsDirectly(videoId, html, title);
  }

  // Fetch transcript via InnerTube API
  const innertubeResponse = await fetch(
    `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20231121.01.00',
          },
        },
        params: transcriptParams,
      }),
    }
  );

  if (!innertubeResponse.ok) {
    console.log('InnerTube API failed, falling back to direct captions...');
    return await fetchCaptionsDirectly(videoId, html, title);
  }

  const innertubeData = await innertubeResponse.json();
  
  // Parse transcript from InnerTube response
  const transcriptRenderer = innertubeData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer;
  const bodyRenderer = transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer;
  const segments: TranscriptSegment[] = [];
  
  if (bodyRenderer?.initialSegments) {
    for (const segment of bodyRenderer.initialSegments) {
      const seg = segment?.transcriptSegmentRenderer;
      if (seg) {
        const text = seg.snippet?.runs?.map((r: any) => r.text).join('') || '';
        const startMs = parseInt(seg.startMs || '0', 10);
        const endMs = parseInt(seg.endMs || '0', 10);
        
        if (text) {
          segments.push({
            text: decodeHtmlEntities(text),
            offset: startMs,
            duration: endMs - startMs,
          });
        }
      }
    }
  }

  if (segments.length === 0) {
    console.log('No segments from InnerTube, falling back to direct captions...');
    return await fetchCaptionsDirectly(videoId, html, title);
  }

  console.log(`Parsed ${segments.length} segments via InnerTube`);
  return { title, segments };
}

async function fetchCaptionsDirectly(videoId: string, html: string, title: string): Promise<{ title: string; segments: TranscriptSegment[] }> {
  console.log('Attempting direct caption fetch...');
  
  // Try to find captionTracks in the page
  const captionTracksMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*(?:,\s*"audioTracks"|,\s*"translationLanguages"|\})/);
  
  let captionTracks: any[] = [];
  
  if (captionTracksMatch) {
    try {
      let tracksJson = captionTracksMatch[1];
      // Clean up the JSON
      const lastBracket = tracksJson.lastIndexOf(']');
      if (lastBracket > 0 && lastBracket < tracksJson.length - 1) {
        tracksJson = tracksJson.substring(0, lastBracket + 1);
      }
      captionTracks = JSON.parse(tracksJson);
      console.log(`Found ${captionTracks.length} caption track(s) in page`);
    } catch (e) {
      console.error('Failed to parse captionTracks:', e);
    }
  }

  if (captionTracks.length === 0) {
    // Try alternative parsing via ytInitialPlayerResponse
    const playerResponseMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});(?:\s*var|\s*<)/);
    if (playerResponseMatch) {
      try {
        // Use a more careful approach to extract JSON
        const jsonStr = playerResponseMatch[1];
        const captionsMatch = jsonStr.match(/"captions":\s*\{[\s\S]*?"captionTracks":\s*(\[[\s\S]*?\])/);
        if (captionsMatch) {
          captionTracks = JSON.parse(captionsMatch[1]);
          console.log(`Found ${captionTracks.length} caption track(s) via playerResponse`);
        }
      } catch (e) {
        console.error('Failed to parse playerResponse captions:', e);
      }
    }
  }

  if (captionTracks.length === 0) {
    // Last resort: look for timedtext URL pattern
    const timedtextMatch = html.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"'\s]+/g);
    if (timedtextMatch && timedtextMatch.length > 0) {
      console.log('Found timedtext URLs, using first one...');
      const timedtextUrl = timedtextMatch[0].replace(/\\u0026/g, '&');
      return await fetchFromTimedTextUrl(timedtextUrl, title);
    }
    
    throw new Error('No captions available for this video');
  }

  // Find best caption track (prefer English manual, then English auto, then any)
  let selectedTrack = captionTracks.find((t: any) => 
    (t.languageCode === 'en' || t.languageCode?.startsWith('en-')) && t.kind !== 'asr'
  );
  
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t: any) => 
      t.languageCode === 'en' || t.languageCode?.startsWith('en-')
    );
  }
  
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t: any) => t.kind !== 'asr');
  }
  
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
  }

  if (!selectedTrack?.baseUrl) {
    throw new Error('No valid caption track found');
  }

  console.log(`Using caption track: ${selectedTrack.languageCode} (${selectedTrack.kind || 'manual'})`);
  
  return await fetchFromTimedTextUrl(selectedTrack.baseUrl, title);
}

async function fetchFromTimedTextUrl(url: string, title: string): Promise<{ title: string; segments: TranscriptSegment[] }> {
  const captionsResponse = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!captionsResponse.ok) {
    throw new Error(`Failed to fetch captions: ${captionsResponse.status}`);
  }

  const captionsXml = await captionsResponse.text();
  console.log(`Fetched captions XML, length: ${captionsXml.length}`);

  const segments: TranscriptSegment[] = [];
  const textMatches = captionsXml.matchAll(/<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([^<]*)<\/text>/g);

  for (const match of textMatches) {
    const start = parseFloat(match[1]) * 1000;
    const duration = match[2] ? parseFloat(match[2]) * 1000 : 0;
    const text = decodeHtmlEntities(match[3]);

    if (text) {
      segments.push({ text, offset: start, duration });
    }
  }

  if (segments.length === 0) {
    throw new Error('Failed to parse transcript segments');
  }

  console.log(`Parsed ${segments.length} segments from XML`);
  return { title, segments };
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

    console.log(`=== Fetching transcript for video: ${videoId} ===`);

    const { title, segments } = await fetchTranscriptViaInnerTube(videoId);
    const transcript = segments.map(s => s.text).join(' ');

    console.log(`=== Successfully fetched transcript (${transcript.length} chars) ===`);

    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        title,
        transcript,
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
