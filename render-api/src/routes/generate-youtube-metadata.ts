import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

interface YouTubeMetadataRequest {
  title: string;
  script: string;
}

interface YouTubeMetadataResponse {
  success: boolean;
  titles?: string[];
  description?: string;
  tags?: string[];
  error?: string;
}

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log('[generate-youtube-metadata] Starting metadata generation');

  try {
    const { title, script } = req.body as YouTubeMetadataRequest;

    if (!script || script.trim().length === 0) {
      console.error('[generate-youtube-metadata] No script provided');
      return res.status(400).json({
        success: false,
        error: 'Script content is required',
      } as YouTubeMetadataResponse);
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Truncate script if too long (keep first 8000 chars for context)
    const truncatedScript = script.length > 8000
      ? script.substring(0, 8000) + '...[truncated]'
      : script;

    const systemPrompt = `You are an expert YouTube SEO specialist and content strategist. Your task is to generate optimized YouTube metadata that will maximize views and engagement for historical documentary content.

Generate metadata that:
- Uses proven YouTube SEO techniques
- Includes power words and emotional hooks
- Is historically accurate
- Appeals to history enthusiasts and general audiences
- Maximizes click-through rate (CTR)

IMPORTANT: Return your response in valid JSON format only, with no additional text or markdown.`;

    const userPrompt = `Based on this historical video script, generate YouTube metadata.

Video Title (for context): ${title || 'Historical Documentary'}

Script Content:
${truncatedScript}

Generate the following in JSON format:
{
  "titles": [
    // Generate exactly 10 title options (max 100 characters each)
    // Mix different styles:
    // - 2-3 curiosity-driven titles with questions or mystery
    // - 2-3 dramatic/emotional titles
    // - 2-3 educational/informative titles
    // - 2 clickbait-style (but still accurate) titles
    // Include relevant years/dates when applicable
    // Use power words: secrets, hidden, untold, forgotten, shocking, etc.
  ],
  "description": "// A compelling 2-3 paragraph description (500-1000 characters):\\n// - Start with a hook that creates curiosity\\n// - Summarize the key historical content\\n// - Include relevant keywords naturally\\n// - End with a call-to-action\\n// Use line breaks (\\n) for formatting",
  "tags": [
    // Generate exactly 15-20 highly relevant tags for YouTube SEO
    // Each tag should be lowercase and focused:
    // - 3-4 specific topic keywords (e.g., "roman empire", "medieval history")
    // - 3-4 era/time period tags (e.g., "ancient history", "15th century")
    // - 3-4 key figures/places mentioned (e.g., "julius caesar", "constantinople")
    // - 3-4 broader category tags (e.g., "history documentary", "educational", "history channel")
    // - 2-3 trending/popular history tags (e.g., "dark history", "untold stories")
    // DO NOT include generic tags like "video" or "youtube"
  ]
}

Return ONLY valid JSON, no markdown code blocks or other text.`;

    console.log('[generate-youtube-metadata] Calling Claude API...');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    // Extract text content
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    let metadata: { titles: string[]; description: string; tags: string[] };
    try {
      // Clean up response - remove markdown code blocks if present
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      }
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      metadata = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('[generate-youtube-metadata] Failed to parse JSON:', textContent.text);
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate response structure
    if (!Array.isArray(metadata.titles) || metadata.titles.length === 0) {
      throw new Error('Invalid titles in response');
    }
    if (typeof metadata.description !== 'string') {
      throw new Error('Invalid description in response');
    }
    if (!Array.isArray(metadata.tags)) {
      metadata.tags = [];
    }

    // Ensure we have exactly 10 titles, truncate if too long
    const titles = metadata.titles.slice(0, 10).map(t =>
      t.length > 100 ? t.substring(0, 97) + '...' : t
    );

    const duration = Date.now() - startTime;
    console.log(`[generate-youtube-metadata] Generated ${titles.length} titles in ${duration}ms`);

    return res.json({
      success: true,
      titles,
      description: metadata.description,
      tags: metadata.tags,
    } as YouTubeMetadataResponse);

  } catch (error) {
    console.error('[generate-youtube-metadata] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate metadata',
    } as YouTubeMetadataResponse);
  }
});

export default router;
