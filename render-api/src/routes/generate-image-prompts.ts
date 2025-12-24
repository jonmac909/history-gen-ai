import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

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

    console.log(`Generating ${imageCount} image prompts from script and SRT...`);

    // Parse SRT and group into time windows
    const segments = parseSrt(srtContent);
    const windows = groupSegmentsForImages(segments, imageCount, audioDuration);

    console.log(`Parsed ${segments.length} SRT segments into ${windows.length} time windows`);

    // Build context for Claude
    const windowDescriptions = windows.map((w, i) =>
      `IMAGE ${i + 1} (${formatTimecodeForFilename(w.startSeconds)} to ${formatTimecodeForFilename(w.endSeconds)}):\nNarration being spoken: "${w.text}"`
    ).join('\n\n');

    // Send initial progress
    sendEvent({ type: 'progress', progress: 5, message: '5%' });

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // Use streaming to show progress
    let fullResponse = '';
    let lastProgress = 5;

    // Estimate tokens: ~100 words per scene description, ~1.3 tokens per word
    const estimatedTokens = imageCount * 130;

    const messageStream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: `You are an expert at creating visual scene descriptions for documentary video image generation. You MUST always output valid JSON - never ask questions or request clarification.

YOUR TASK: Create visual scene descriptions based on the script and narration segments provided. Even if the narration is sparse or technical, you MUST generate appropriate visual scenes.

RULES:
1. READ the script context to understand the overall topic
2. For each image segment, create a visual scene that illustrates the content
3. If narration is sparse, use the script context to infer appropriate visuals
4. For technical/abstract topics: visualize people using technology, historical contexts, symbolic representations, or documentary-style scenes
5. Include specific details: setting, lighting, objects, people, actions, atmosphere
6. 50-100 words per description
7. Do NOT include any text, titles, or words in the image

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

SCRIPT CONTEXT:
${script.substring(0, 12000)}

TIME-CODED SEGMENTS:
${windowDescriptions}

Remember: Output ONLY a JSON array with ${imageCount} items. No explanations.`
        }
      ],
    });

    // Process stream and track progress
    for await (const event of messageStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;

        // Count completed scenes by counting closing braces with sceneDescription
        const completedScenes = (fullResponse.match(/\"sceneDescription\"\s*:\s*\"[^\"]+\"/g) || []).length;
        const progress = Math.min(95, 5 + Math.round((completedScenes / imageCount) * 90));

        if (progress > lastProgress) {
          lastProgress = progress;
          sendEvent({ type: 'progress', progress, message: `${progress}%` });
        }
      }
    }

    // Parse the JSON response
    let sceneDescriptions: { index: number; sceneDescription: string }[];
    try {
      const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }
      sceneDescriptions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', fullResponse.substring(0, 500));
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
