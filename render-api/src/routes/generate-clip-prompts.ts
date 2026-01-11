import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Constants
const CLIP_COUNT = 5;  // 5 clips at 12 seconds each = 60 seconds intro
const CLIP_DURATION = 12;  // 12 seconds per clip (Seedance max)
const TOTAL_CLIP_DURATION = CLIP_COUNT * CLIP_DURATION;  // 60 seconds

interface ClipPrompt {
  index: number;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  sceneDescription: string;
}

interface SrtSegment {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

// Modern/anachronistic keywords to filter from scene descriptions
// Reused from generate-image-prompts.ts
const MODERN_KEYWORDS_TO_REMOVE = [
  'museum', 'exhibit', 'exhibition', 'display case', 'display cases', 'gallery', 'galleries',
  'artifact', 'artifacts', 'archaeological', 'archaeology', 'excavation', 'excavated',
  'preserved', 'preservation', 'restoration', 'restored', 'replica', 'replicas', 'reconstruction',
  'curator', 'curators', 'visitor', 'visitors', 'tourist', 'tourists',
  'specimen', 'specimens', 'diorama', 'collection', 'collections',
  'researcher', 'researchers', 'scientist', 'scientists', 'historian', 'historians',
  'scholar', 'scholars', 'academic', 'academics', 'professor', 'professors',
  'laboratory', 'lab coat', 'lab coats', 'research facility', 'research facilities',
  'university', 'institution', 'facility', 'clinical', 'sterile',
  'study', 'studies', 'analysis', 'analyzed', 'examination', 'examined',
  'documentation', 'documented', 'records show', 'evidence suggests',
  'research', 'microscope', 'microscopes', 'magnifying glass', 'magnifying glasses',
  'geologist', 'geologists', 'geological', 'geology',
  'archaeologist', 'archaeologists',
  'anthropologist', 'anthropologists',
  'expert', 'experts', 'specialist', 'specialists',
  'team of', 'survey team', 'field team', 'research team',
  'taking notes', 'field notes', 'notebook', 'notebooks',
  'equipment', 'instruments', 'tools', 'measuring',
  'scientific', 'science',
  'map', 'maps', 'parchment map', 'antique map', 'historical map', 'topographical',
  'scroll', 'scrolls', 'document', 'documents', 'manuscript', 'manuscripts',
  'chart', 'charts', 'diagram', 'diagrams', 'blueprint', 'blueprints',
  'studying', 'examining', 'inspecting', 'analyzing', 'reviewing',
  'close-up of', 'detailed view of', 'closeup of',
  'placard', 'placards', 'label', 'labels', 'caption', 'captions',
  'modern', 'contemporary', 'present-day', 'present day', 'today', "today's",
  'photograph', 'photography', 'camera', 'cameras', 'digital', 'computer', 'computers',
  'electric', 'electricity', 'neon', 'fluorescent', 'led', 'spotlight', 'spotlights',
  'glass case', 'glass cases', 'plexiglass', 'acrylic',
  'tablet', 'screen', 'monitor', 'display',
  'field clothes', 'field gear', 'protective gear', 'sun hats',
  'vehicles', 'field vehicles',
  'documentary', 'educational', 'illustration', 'infographic',
  'recreation', 'reenactment', 're-enactment', 'dramatization',
  'depicting', 'representation', 'interpretation', 'imagined', 'imagining',
  "artist's", 'artistic rendering',
  'interactive', 'interactive displays',
  'centuries later', 'years later', 'in hindsight', 'looking back',
  'historical record', 'historical records', 'ancient text', 'ancient texts',
  'surviving', 'survives', 'remains of', 'ruins of', 'remnants of',
  'investigation', 'investigating',
];

// Check if description contains any modern keywords
function containsModernKeywords(description: string): string[] {
  const found: string[] = [];
  for (const keyword of MODERN_KEYWORDS_TO_REMOVE) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (regex.test(description)) {
      found.push(keyword);
    }
  }
  return found;
}

// Regenerate a single prompt that contains modern keywords
async function regeneratePrompt(
  anthropic: Anthropic,
  originalDescription: string,
  foundKeywords: string[],
  narrationText: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `TASK: Completely rewrite this VIDEO SCENE description to show the ACTUAL HISTORICAL EVENT, not a modern interpretation.

PROBLEMATIC ORIGINAL (contains modern framing):
"${originalDescription}"

DETECTED MODERN TERMS: ${foundKeywords.join(', ')}

WHAT THE NARRATION SAYS:
"${narrationText}"

REQUIREMENTS FOR VIDEO SCENE:
1. Show the scene AS IF YOU WERE THERE in ancient/historical times
2. NO modern people (no scientists, researchers, geologists, historians)
3. NO modern settings (no museums, labs, classrooms, excavation sites)
4. Show PEOPLE FROM THAT ERA doing things they would actually do
5. Include MOTION descriptions (what moves, how things animate)
6. Include camera movement suggestions (dolly, pan, tracking shot)
7. 50-100 words maximum

Write ONLY the description, no quotes or explanation.`
      }]
    });

    const content = response.content[0];
    if (content.type === 'text') {
      return content.text.trim().replace(/^["']|["']$/g, '');
    }
    return originalDescription;
  } catch (error) {
    console.error('Failed to regenerate clip prompt:', error);
    return originalDescription;
  }
}

// Parse SRT timestamp to seconds
function parseSrtTime(timeStr: string): number {
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
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

// Get SRT segments for the first 100 seconds (intro clip duration)
function getIntroSegments(segments: SrtSegment[]): SrtSegment[] {
  return segments.filter(seg => seg.startSeconds < TOTAL_CLIP_DURATION);
}

// Group intro segments into 10-second clip windows
function groupSegmentsForClips(segments: SrtSegment[]): { startSeconds: number; endSeconds: number; text: string }[] {
  const windows: { startSeconds: number; endSeconds: number; text: string }[] = [];

  for (let i = 0; i < CLIP_COUNT; i++) {
    const windowStart = i * CLIP_DURATION;
    const windowEnd = (i + 1) * CLIP_DURATION;

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

router.post('/', async (req: Request, res: Response) => {
  const { script, srtContent, stylePrompt, stream } = req.body;

  const selectedModel = 'claude-sonnet-4-5-20250929';

  // Keepalive interval for SSE
  let heartbeatInterval: NodeJS.Timeout | null = null;

  // Setup SSE if streaming is enabled
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    heartbeatInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);
  }

  const sendEvent = (data: any) => {
    if (stream) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  try {
    if (!script || !srtContent) {
      const error = { error: 'Script and SRT content are required' };
      if (stream) {
        sendEvent({ type: 'error', ...error });
        cleanup();
        return res.end();
      }
      return res.status(400).json(error);
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      const error = { error: 'Anthropic API key not configured' };
      if (stream) {
        sendEvent({ type: 'error', ...error });
        cleanup();
        return res.end();
      }
      return res.status(500).json(error);
    }

    console.log(`🎬 Generating ${CLIP_COUNT} video clip prompts for ${TOTAL_CLIP_DURATION}s intro...`);

    // Parse SRT and get intro segments (first 100 seconds)
    const allSegments = parseSrt(srtContent);
    const introSegments = getIntroSegments(allSegments);
    const windows = groupSegmentsForClips(introSegments);

    console.log(`Parsed ${allSegments.length} SRT segments, using ${introSegments.length} for intro clips`);

    // Send initial progress
    sendEvent({ type: 'progress', progress: 5, message: 'Preparing clip prompts...' });

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // Get the intro portion of the script (approximately first 100 seconds worth)
    // Assuming ~150 words per minute = ~250 words for 100 seconds
    const introScriptWords = script.split(/\s+/).slice(0, 300).join(' ');

    // Build narration context for each clip
    const clipDescriptions = windows.map((w, i) =>
      `CLIP ${i + 1} (${w.startSeconds}s - ${w.endSeconds}s):\nNarration: "${w.text}"`
    ).join('\n\n');

    // System prompt optimized for video clip generation - SHORT and SIMPLE
    const systemPrompt = `You create SHORT video scene descriptions for AI video generation.

RULES:
- 15-30 words per description MAXIMUM
- Include ONE camera movement (pan, dolly, tracking)
- Show historical scenes AS THEY HAPPENED - people living, not modern analysis
- No museums, researchers, maps, documents, artifacts on display

Output format - JSON array ONLY:
[{"index": 1, "sceneDescription": "..."}, {"index": 2, "sceneDescription": "..."}]`;

    const systemConfig = [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const }
      }
    ];

    sendEvent({ type: 'progress', progress: 15, message: 'Generating video prompts...' });

    let fullResponse = '';

    const messageStream = await anthropic.messages.stream({
      model: selectedModel,
      max_tokens: 4096,
      system: systemConfig,
      messages: [
        {
          role: 'user',
          content: `Generate exactly ${CLIP_COUNT} cinematic video scene descriptions for the intro of a historical documentary.

SCRIPT CONTEXT (first ~100 seconds):
${introScriptWords}

TIME-CODED SEGMENTS FOR EACH ${CLIP_DURATION}-SECOND CLIP:
${clipDescriptions}

STYLE GUIDANCE: ${stylePrompt || 'Historically accurate, immersive first-person perspective'}

Remember:
- Each clip is ${CLIP_DURATION} seconds long
- Include camera movements and motion descriptions
- Show the era authentically with dynamic scenes
- Output ONLY a JSON array with ${CLIP_COUNT} items`
        }
      ],
    });

    // Process stream
    for await (const event of messageStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;

        // Track progress based on completed descriptions
        const completedCount = (fullResponse.match(/\"sceneDescription\"\s*:\s*\"[^\"]+\"/g) || []).length;
        const progress = Math.min(70, 15 + Math.round((completedCount / CLIP_COUNT) * 55));
        sendEvent({ type: 'progress', progress, message: `Generated ${completedCount}/${CLIP_COUNT} video prompts...` });
      }
    }

    // Parse JSON response
    const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    const sceneDescriptions = JSON.parse(jsonMatch[0]) as { index: number; sceneDescription: string }[];

    console.log(`Generated ${sceneDescriptions.length} clip descriptions`);

    // Check for modern keywords and regenerate if needed
    sendEvent({ type: 'progress', progress: 75, message: 'Checking for modern keywords...' });

    interface RegenTask {
      index: number;
      sceneDesc: string;
      foundKeywords: string[];
      narrationText: string;
    }
    const regenTasks: RegenTask[] = [];

    for (let i = 0; i < windows.length; i++) {
      const scene = sceneDescriptions.find(s => s.index === i + 1);
      const sceneDesc = scene?.sceneDescription || `Historical scene: ${windows[i].text.substring(0, 200)}`;
      const foundKeywords = containsModernKeywords(sceneDesc);

      if (foundKeywords.length > 0) {
        regenTasks.push({
          index: i,
          sceneDesc,
          foundKeywords,
          narrationText: windows[i].text,
        });
      }
    }

    const regeneratedDescriptions = new Map<number, string>();

    if (regenTasks.length > 0) {
      console.log(`Found ${regenTasks.length} clip prompts with modern keywords, regenerating...`);
      sendEvent({ type: 'progress', progress: 80, message: `Regenerating ${regenTasks.length} prompts...` });

      // Regenerate in parallel (clips are fewer, so we can do all at once)
      const regenResults = await Promise.all(
        regenTasks.map(async (task) => {
          console.log(`Clip ${task.index + 1}: Found modern keywords [${task.foundKeywords.join(', ')}], regenerating...`);
          const finalDesc = await regeneratePrompt(anthropic, task.sceneDesc, task.foundKeywords, task.narrationText);
          return { index: task.index, description: finalDesc };
        })
      );

      for (const result of regenResults) {
        regeneratedDescriptions.set(result.index, result.description);
      }
    }

    // Build final clip prompts
    const clipPrompts: ClipPrompt[] = [];

    for (let i = 0; i < CLIP_COUNT; i++) {
      const window = windows[i];
      const scene = sceneDescriptions.find(s => s.index === i + 1);

      const sceneDesc = regeneratedDescriptions.get(i)
        || scene?.sceneDescription
        || `Historical scene: ${window.text.substring(0, 200)}`;

      clipPrompts.push({
        index: i + 1,
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        sceneDescription: sceneDesc,
        prompt: stylePrompt ? `${stylePrompt}. ${sceneDesc}` : sceneDesc,
      });
    }

    console.log(`✅ Generated ${clipPrompts.length} video clip prompts (regenerated ${regenTasks.length} with modern keywords)`);

    const result = {
      success: true,
      prompts: clipPrompts,
      totalDuration: TOTAL_CLIP_DURATION,
      clipCount: CLIP_COUNT,
      clipDuration: CLIP_DURATION,
    };

    if (stream) {
      sendEvent({ type: 'progress', progress: 100, message: 'Complete!' });
      sendEvent({ type: 'complete', ...result });
      cleanup();
      res.end();
    } else {
      return res.json(result);
    }

  } catch (error) {
    console.error('Error generating clip prompts:', error);

    if (stream) {
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to generate clip prompts'
      });
      cleanup();
      res.end();
    } else {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate clip prompts' });
    }
  }
});

export default router;
