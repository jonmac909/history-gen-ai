import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SrtSegment {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface ImagePromptRequest {
  script: string;
  srtContent: string;
  imageCount: number;
  stylePrompt: string;
  audioDuration?: number; // Optional audio duration in seconds
}

interface ImagePrompt {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  sceneDescription: string;
}

// Parse SRT timestamp to seconds
function parseSrtTime(timeStr: string): number {
  // Format: HH:MM:SS,mmm
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

// Format seconds to timecode for filenames (HH-MM-SS)
function formatTimecodeForFilename(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hours.toString().padStart(2, '0')}-${minutes.toString().padStart(2, '0')}-${secs.toString().padStart(2, '0')}`;
}

// Parse SRT content into segments
function parseSrt(srtContent: string): SrtSegment[] {
  const segments: SrtSegment[] = [];
  const blocks = srtContent.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timeLine = lines[1];
    const text = lines.slice(2).join(' ').trim();

    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    segments.push({
      index,
      startTime: timeMatch[1],
      endTime: timeMatch[2],
      startSeconds: parseSrtTime(timeMatch[1]),
      endSeconds: parseSrtTime(timeMatch[2]),
      text,
    });
  }

  return segments;
}

// Group SRT segments into time windows for images
function groupSegmentsForImages(segments: SrtSegment[], imageCount: number, audioDuration?: number): { startSeconds: number; endSeconds: number; text: string }[] {
  if (segments.length === 0) return [];

  // Use provided audio duration if available, otherwise fall back to last SRT segment end time
  const totalDuration = audioDuration || segments[segments.length - 1].endSeconds;
  const windowDuration = totalDuration / imageCount;

  console.log(`Distributing ${imageCount} images across ${totalDuration.toFixed(2)}s (audio duration: ${audioDuration?.toFixed(2) || 'N/A'}s, SRT end: ${segments[segments.length - 1].endSeconds.toFixed(2)}s)`);

  const windows: { startSeconds: number; endSeconds: number; text: string }[] = [];

  for (let i = 0; i < imageCount; i++) {
    const windowStart = i * windowDuration;
    const windowEnd = (i + 1) * windowDuration;

    // Collect text from segments that overlap with this window
    const overlappingSegments = segments.filter(seg =>
      seg.startSeconds < windowEnd && seg.endSeconds > windowStart
    );

    const text = overlappingSegments.map(s => s.text).join(' ');

    windows.push({
      startSeconds: windowStart,
      endSeconds: windowEnd,
      text: text || `Scene ${i + 1}`,
    });
  }

  return windows;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, srtContent, imageCount, stylePrompt, audioDuration }: ImagePromptRequest = await req.json();

    if (!script || !srtContent) {
      return new Response(
        JSON.stringify({ error: 'Script and SRT content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating ${imageCount} image prompts from script and SRT...`);
    if (audioDuration) {
      console.log(`Using provided audio duration: ${audioDuration.toFixed(2)}s`);
    }

    // Parse SRT and group into time windows
    const segments = parseSrt(srtContent);
    const windows = groupSegmentsForImages(segments, imageCount, audioDuration);

    console.log(`Parsed ${segments.length} SRT segments into ${windows.length} time windows`);

    // Build context for Claude
    const windowDescriptions = windows.map((w, i) =>
      `IMAGE ${i + 1} (${formatTimecodeForFilename(w.startSeconds)} to ${formatTimecodeForFilename(w.endSeconds)}):\nNarration: "${w.text.substring(0, 500)}"`
    ).join('\n\n');

    // Call Claude to generate visual scene descriptions
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are an expert at creating visual scene descriptions for AI image generation.
Your task is to analyze documentary narration and create vivid, specific visual scene descriptions that can be used as prompts for an AI image generator.

CRITICAL RULES:
1. Each scene description must be a VISUAL description - what the viewer would SEE, not hear
2. Include specific details: setting, lighting, objects, people, actions, atmosphere
3. Describe historical scenes accurately based on the era and context
4. Focus on a single, clear composition for each image
5. Do NOT include any text, titles, or words that would appear in the image
6. Make each scene distinct and visually interesting
7. Include period-appropriate details (clothing, architecture, technology)

Output format: Return ONLY a JSON array with objects containing:
- "index": number (1-based)
- "sceneDescription": string (the visual scene description, 50-100 words)

Example output:
[
  {"index": 1, "sceneDescription": "A dimly lit colonial tavern interior at night, wooden beams overhead, men in 18th century coats gathered around a table with quill pens and parchment, candlelight casting warm shadows on their determined faces, period maps on the wall"},
  {"index": 2, "sceneDescription": "A bustling harbor at dawn, tall-masted ships with unfurled sails, dock workers in period clothing loading wooden crates, seagulls in flight, morning mist rolling across the water"}
]`,
        messages: [
          {
            role: 'user',
            content: `Create ${imageCount} visual scene descriptions for these documentary segments.

FULL SCRIPT CONTEXT:
${script.substring(0, 8000)}

TIME-CODED SEGMENTS TO VISUALIZE:
${windowDescriptions}

Generate exactly ${imageCount} scene descriptions, one for each time window. Return ONLY the JSON array, no other text.`
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';

    // Parse the JSON response
    let sceneDescriptions: { index: number; sceneDescription: string }[];
    try {
      // Extract JSON from response (in case there's any surrounding text)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }
      sceneDescriptions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', responseText);
      throw new Error('Failed to parse image descriptions from AI');
    }

    // Build final prompts with style and timing info
    const imagePrompts: ImagePrompt[] = windows.map((window, i) => {
      const scene = sceneDescriptions.find(s => s.index === i + 1);
      const sceneDesc = scene?.sceneDescription || `Historical scene depicting: ${window.text.substring(0, 200)}`;

      return {
        index: i + 1,
        startTime: formatTimecodeForFilename(window.startSeconds),
        endTime: formatTimecodeForFilename(window.endSeconds),
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        sceneDescription: sceneDesc,
        prompt: `${stylePrompt}. ${sceneDesc}`,
      };
    });

    console.log(`Generated ${imagePrompts.length} image prompts successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        prompts: imagePrompts,
        totalDuration: segments.length > 0 ? segments[segments.length - 1].endSeconds : 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating image prompts:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate image prompts' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
