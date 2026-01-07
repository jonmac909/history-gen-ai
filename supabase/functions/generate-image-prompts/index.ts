import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// Modern/anachronistic keywords to filter from scene descriptions
// These words suggest modern settings (museums, research, etc.) rather than historical scenes
const MODERN_KEYWORDS_TO_REMOVE = [
  // Museum/exhibition context
  'museum', 'exhibit', 'exhibition', 'display case', 'display cases', 'gallery', 'galleries',
  'artifact', 'artifacts', 'archaeological', 'archaeology', 'excavation', 'excavated',
  'preserved', 'restoration', 'restored', 'replica', 'replicas', 'reconstruction',
  'curator', 'curators', 'visitor', 'visitors', 'tourist', 'tourists',
  'specimen', 'specimens',

  // Academic/research context
  'researcher', 'researchers', 'scientist', 'scientists', 'historian', 'historians',
  'scholar', 'scholars', 'academic', 'academics', 'professor', 'professors',
  'laboratory', 'lab coat', 'lab coats', 'research facility', 'research facilities',
  'university', 'institution', 'facility', 'clinical', 'sterile',
  'study', 'studies', 'analysis', 'analyzed', 'examination', 'examined',
  'documentation', 'documented', 'records show', 'evidence suggests',
  'research', 'microscope', 'magnifying glass',

  // Modern technology/settings
  'modern', 'contemporary', 'present-day', 'present day', 'today', "today's",
  'photograph', 'photography', 'camera', 'cameras', 'digital', 'computer', 'computers',
  'electric', 'electricity', 'neon', 'fluorescent', 'led', 'spotlight', 'spotlights',
  'glass case', 'glass cases', 'plexiglass', 'acrylic',
  'tablet', 'screen', 'monitor',

  // Documentary/educational framing
  'documentary', 'educational', 'illustration', 'diagram', 'infographic',
  'recreation', 'reenactment', 're-enactment', 'dramatization',
  'depicting', 'representation', 'interpretation', 'imagined', 'imagining',

  // Time-reference phrases that break immersion
  'centuries later', 'years later', 'in hindsight', 'looking back',
  'historical record', 'historical records', 'ancient text', 'ancient texts',
  'surviving', 'survives', 'remains of', 'ruins of', 'remnants of',
];

// Filter modern keywords from a scene description
function filterModernKeywords(description: string): string {
  let filtered = description;

  for (const keyword of MODERN_KEYWORDS_TO_REMOVE) {
    // Case-insensitive replacement, preserve surrounding text
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    filtered = filtered.replace(regex, '');
  }

  // Clean up any double spaces or awkward punctuation left behind
  filtered = filtered
    .replace(/\s+/g, ' ')           // Multiple spaces to single
    .replace(/\s+,/g, ',')          // Space before comma
    .replace(/,\s*,/g, ',')         // Double commas
    .replace(/\.\s*\./g, '.')       // Double periods
    .replace(/\s+\./g, '.')         // Space before period
    .replace(/^\s+|\s+$/g, '')      // Trim
    .replace(/^,\s*/, '')           // Leading comma
    .replace(/,\s*$/, '');          // Trailing comma

  return filtered;
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

    // Build context for Claude - include full narration text for each window
    const windowDescriptions = windows.map((w, i) =>
      `IMAGE ${i + 1} (${formatTimecodeForFilename(w.startSeconds)} to ${formatTimecodeForFilename(w.endSeconds)}):\nNarration being spoken: "${w.text}"`
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
        max_tokens: 8192,
        system: `You are an expert at creating visual scene descriptions for documentary video image generation. You MUST always output valid JSON - never ask questions or request clarification.

YOUR TASK: Create visual scene descriptions based on the script and narration segments provided. Even if the narration is sparse or technical, you MUST generate appropriate visual scenes.

RULES:
1. FIRST, analyze the MASTER STYLE PROMPT to understand the visual art style being requested
2. SECOND, READ the script context carefully to identify the EXACT historical time period and geographic location (e.g., "Ancient Rome 100 AD", "Victorian England 1880s", "Tang Dynasty China", "Renaissance Florence", "Ancient Egypt", "Colonial America 1700s")
3. For each image segment, create a visual scene that illustrates the narration content
4. If narration is sparse, use the script context to infer appropriate visuals
5. CRITICAL: ALL scenes MUST match the EXACT historical era from the script. Examples:
   - Script about Ancient Rome → Roman architecture, togas, forums, temples
   - Script about Victorian era → Gas lamps, corsets, horse carriages, industrial cities
   - Script about Renaissance → Merchant guilds, cathedrals, early printing, artistic workshops
   - Script about Ancient Egypt → Pyramids, pharaohs, Nile river, hieroglyphics
   - NEVER show scenes from the wrong era (no medieval castles in Roman scripts, no Victorian clothing in Egyptian scripts)
6. For abstract concepts (like sleep patterns, economics, beliefs): show period-appropriate scenes that illustrate the concept using settings, objects, and people from that SPECIFIC era
7. You may depict dramatic historical scenes including warfare, battles, destruction, and conflict - but avoid explicit gore, graphic wounds, torture closeups, or gratuitous violence. Show the drama and scale of historical events appropriately.
8. For medical/surgical topics: show the setting, tools, or aftermath - NOT graphic procedures
9. NEVER show modern settings like museums, laboratories, research facilities, display cases, scientists in lab coats, or any contemporary/academic environments. ALL scenes must be set IN the historical period being discussed, showing events AS THEY HAPPENED, not modern people studying history.
10. Include specific details: setting, lighting, objects, people, actions, atmosphere - all accurate to the historical period
11. 50-100 words per description
12. Do NOT include any text, titles, or words in the image

CRITICAL: You MUST return ONLY a valid JSON array. No explanations, no questions, no commentary.

Output format:
[
  {"index": 1, "sceneDescription": "..."},
  {"index": 2, "sceneDescription": "..."}
]`,
        messages: [
          {
            role: 'user',
            content: `Generate exactly ${imageCount} visual scene descriptions. Return ONLY the JSON array, nothing else.

MASTER STYLE PROMPT (defines the visual art style):
${stylePrompt || 'Classical oil painting style'}

SCRIPT CONTEXT (read this to determine the historical era):
${script.substring(0, 12000)}

TIME-CODED SEGMENTS:
${windowDescriptions}

Remember:
1. Identify the historical era from the SCRIPT CONTEXT above
2. Every scene MUST be set in that exact era - not medieval unless the script is about medieval times
3. Output ONLY a JSON array with ${imageCount} items. No explanations.`
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
    // Apply modern keyword filter to remove anachronistic terms
    let filteredCount = 0;
    const imagePrompts: ImagePrompt[] = windows.map((window, i) => {
      const scene = sceneDescriptions.find(s => s.index === i + 1);
      const rawSceneDesc = scene?.sceneDescription || `Historical scene depicting: ${window.text.substring(0, 200)}`;

      // Filter out modern keywords from the scene description
      const sceneDesc = filterModernKeywords(rawSceneDesc);
      if (sceneDesc !== rawSceneDesc) {
        filteredCount++;
        console.log(`Image ${i + 1}: Filtered modern keywords. Before: "${rawSceneDesc.substring(0, 100)}..." After: "${sceneDesc.substring(0, 100)}..."`);
      }

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

    console.log(`Generated ${imagePrompts.length} image prompts successfully (filtered modern keywords from ${filteredCount} prompts)`);

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
