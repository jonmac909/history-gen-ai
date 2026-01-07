import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Constants
const MAX_TOKENS = 16384;  // Sonnet max tokens
const BATCH_SIZE_PARALLEL = 10; // Smaller batches for parallel processing

interface SrtSegment {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
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
const MODERN_KEYWORDS_TO_REMOVE = [
  // Museum/exhibition context
  'museum', 'exhibit', 'exhibition', 'display case', 'display cases', 'gallery', 'galleries',
  'artifact', 'artifacts', 'archaeological', 'archaeology', 'excavation', 'excavated',
  'preserved', 'restoration', 'restored', 'replica', 'replicas', 'reconstruction',
  'curator', 'curators', 'visitor', 'visitors', 'tourist', 'tourists',
  'specimen', 'specimens', 'diorama',

  // Academic/research context
  'researcher', 'researchers', 'scientist', 'scientists', 'historian', 'historians',
  'scholar', 'scholars', 'academic', 'academics', 'professor', 'professors',
  'laboratory', 'lab coat', 'lab coats', 'research facility', 'research facilities',
  'university', 'institution', 'facility', 'clinical', 'sterile',
  'study', 'studies', 'analysis', 'analyzed', 'examination', 'examined',
  'documentation', 'documented', 'records show', 'evidence suggests',
  'research', 'microscope', 'microscopes', 'magnifying glass', 'magnifying glasses',

  // Modern technology/settings
  'modern', 'contemporary', 'present-day', 'present day', 'today', "today's",
  'photograph', 'photography', 'camera', 'cameras', 'digital', 'computer', 'computers',
  'electric', 'electricity', 'neon', 'fluorescent', 'led', 'spotlight', 'spotlights',
  'glass case', 'glass cases', 'plexiglass', 'acrylic',
  'tablet', 'screen', 'monitor', 'display',

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
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    filtered = filtered.replace(regex, '');
  }

  // Clean up double spaces and punctuation
  filtered = filtered
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+\./g, '.')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '');

  return filtered;
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

  const totalDuration = audioDuration || segments[segments.length - 1].endSeconds;
  const windowDuration = totalDuration / imageCount;

  console.log(`Distributing ${imageCount} images across ${totalDuration.toFixed(2)}s`);

  const windows: { startSeconds: number; endSeconds: number; text: string }[] = [];

  for (let i = 0; i < imageCount; i++) {
    const windowStart = i * windowDuration;
    const windowEnd = (i + 1) * windowDuration;

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
  const { script, srtContent, imageCount, stylePrompt, audioDuration, stream } = req.body;

  // Always use Sonnet for best quality scene descriptions
  const selectedModel = 'claude-sonnet-4-20250514';

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

    console.log(`🚀 Generating ${imageCount} image prompts with ${selectedModel}...`);

    // Parse SRT and group into time windows
    const segments = parseSrt(srtContent);
    const windows = groupSegmentsForImages(segments, imageCount, audioDuration);

    console.log(`Parsed ${segments.length} SRT segments into ${windows.length} time windows`);

    // Send initial progress
    sendEvent({ type: 'progress', progress: 5, message: '5%' });

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // OPTIMIZATION: Use smaller batches (10) for parallel processing
    // This allows multiple API calls to run simultaneously for faster completion
    const numBatches = Math.ceil(imageCount / BATCH_SIZE_PARALLEL);

    console.log(`📊 Processing ${imageCount} prompts in ${numBatches} parallel batch(es) of ${BATCH_SIZE_PARALLEL}`);

    // Track progress across all parallel batches
    const batchProgress: number[] = new Array(numBatches).fill(0);
    const updateTotalProgress = () => {
      const totalCompleted = batchProgress.reduce((a, b) => a + b, 0);
      const progress = Math.min(95, 5 + Math.round((totalCompleted / imageCount) * 90));
      sendEvent({ type: 'progress', progress, message: `${progress}%` });
    };

    // OPTIMIZATION: Define system prompt once for prompt caching
    const systemPrompt = `You are an expert at creating visual scene descriptions for documentary video image generation. You MUST always output valid JSON - never ask questions or request clarification.

YOUR TASK: Create visual scene descriptions based on the script and narration segments provided. Even if the narration is sparse or technical, you MUST generate appropriate visual scenes.

CONTENT SAFETY - STRICTLY PROHIBITED:
- NO nudity, partial nudity, or sexually suggestive content
- NO gore, blood, graphic violence, or injury depictions
- NO weapons being used against people
- NO disturbing, shocking, or traumatic imagery
- NO dead bodies or death scenes
- For war/conflict topics: show maps, documents, leaders in meetings, monuments, museums, artifacts - NOT battle scenes
- For medical topics: show doctors, hospitals, equipment - NOT injuries or procedures
- For crime topics: show courtrooms, documents, buildings - NOT crime scenes

RULES:
1. READ the script context to understand the overall topic
2. For each image segment, create a SAFE, family-friendly visual scene
3. If narration mentions violence/war/death, depict the AFTERMATH (memorials, documents, peaceful scenes) not the event itself
4. For technical/abstract topics: visualize people using technology, historical contexts, symbolic representations, or documentary-style scenes
5. Include specific details: setting, lighting, objects, people, actions, atmosphere
6. 50-100 words per description
7. Do NOT include any text, titles, or words in the image
8. When in doubt, choose the most peaceful, dignified representation

CRITICAL: You MUST return ONLY a valid JSON array. No explanations, no questions, no commentary.

Output format:
[
  {"index": 1, "sceneDescription": "..."},
  {"index": 2, "sceneDescription": "..."}
]`;

    // OPTIMIZATION: Enable prompt caching for system prompt (90% cost reduction on repeat calls)
    const systemConfig = [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const }
      }
    ];

    // Create all batch promises to run in parallel
    const batchPromises = Array.from({ length: numBatches }, async (_, batchIndex) => {
      const batchStart = batchIndex * BATCH_SIZE_PARALLEL;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE_PARALLEL, imageCount);
      const batchWindows = windows.slice(batchStart, batchEnd);
      const batchSize = batchWindows.length;

      // Build context for this batch
      const windowDescriptions = batchWindows.map((w, i) =>
        `IMAGE ${batchStart + i + 1} (${formatTimecodeForFilename(w.startSeconds)} to ${formatTimecodeForFilename(w.endSeconds)}):\nNarration being spoken: "${w.text}"`
      ).join('\n\n');

      // Calculate tokens needed for this batch (use model-specific limit)
      const batchTokens = Math.min(MAX_TOKENS, batchSize * 150 + 500);

      let fullResponse = '';

      const messageStream = await anthropic.messages.stream({
        model: selectedModel,
        max_tokens: batchTokens,
        system: systemConfig,
        messages: [
          {
            role: 'user',
            content: `Generate exactly ${batchSize} visual scene descriptions for images ${batchStart + 1} to ${batchEnd}. Return ONLY the JSON array, nothing else.

SCRIPT CONTEXT:
${script.substring(0, 12000)}

TIME-CODED SEGMENTS:
${windowDescriptions}

Remember: Output ONLY a JSON array with ${batchSize} items, starting with index ${batchStart + 1}. No explanations.`
          }
        ],
      });

      // Process stream and track progress
      for await (const event of messageStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullResponse += event.delta.text;

          // Count completed scenes in this batch
          const completedInBatch = (fullResponse.match(/\"sceneDescription\"\s*:\s*\"[^\"]+\"/g) || []).length;
          batchProgress[batchIndex] = completedInBatch;
          updateTotalProgress();
        }
      }

      // Parse the JSON response for this batch
      const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error(`No JSON array found in batch ${batchIndex + 1} response`);
      }
      const batchDescriptions = JSON.parse(jsonMatch[0]) as { index: number; sceneDescription: string }[];

      // Adjust indices if needed (Claude might start from 1 in each batch)
      for (const desc of batchDescriptions) {
        // If index is within batch range (1 to batchSize), adjust to global index
        if (desc.index >= 1 && desc.index <= batchSize) {
          desc.index = batchStart + desc.index;
        }
      }

      console.log(`Batch ${batchIndex + 1}/${numBatches}: generated ${batchDescriptions.length} descriptions`);
      return batchDescriptions;
    });

    // Run all batches in parallel
    const batchResults = await Promise.all(batchPromises);
    const sceneDescriptions = batchResults.flat();

    // Build final prompts with style and timing info
    // Apply modern keyword filter to remove anachronistic terms
    let filteredCount = 0;
    const imagePrompts: ImagePrompt[] = windows.map((window, i) => {
      const scene = sceneDescriptions.find(s => s.index === i + 1);
      const rawSceneDesc = scene?.sceneDescription || `Historical scene depicting: ${window.text.substring(0, 200)}`;

      // Filter out modern keywords
      const sceneDesc = filterModernKeywords(rawSceneDesc);
      if (sceneDesc !== rawSceneDesc) {
        filteredCount++;
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

    const result = {
      success: true,
      prompts: imagePrompts,
      totalDuration: segments.length > 0 ? segments[segments.length - 1].endSeconds : 0,
    };

    if (stream) {
      sendEvent({ type: 'progress', progress: 100, message: '100%' });
      sendEvent({ type: 'complete', ...result });
      cleanup();
      res.end();
    } else {
      return res.json(result);
    }

  } catch (error) {
    console.error('Error generating image prompts:', error);

    if (stream) {
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to generate image prompts'
      });
      cleanup();
      res.end();
    } else {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate image prompts' });
    }
  }
});

export default router;
