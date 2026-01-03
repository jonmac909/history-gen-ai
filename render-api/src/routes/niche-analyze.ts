import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';

const router = Router();

// YouTube API key from environment
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

interface NicheChannel {
  id: string;
  title: string;
  thumbnailUrl: string;
  subscriberCount: number;
  subscriberCountFormatted: string;
  viewCount: number;
  videoCount: number;
  viewsToSubsRatio: number;
  isBreakout: boolean;
  createdAt?: string;
}

interface NicheMetrics {
  channelCount: number;
  avgSubscribers: number;
  avgViewsPerVideo: number;
  avgViewsToSubsRatio: number;
  saturationLevel: 'low' | 'medium' | 'high';
  saturationScore: number;
}

// Format large numbers (e.g., 1234567 -> "1.2M")
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

// Calculate saturation level based on channel count and views-to-subs ratio
function calculateSaturation(channelCount: number, avgViewsToSubsRatio: number): { level: 'low' | 'medium' | 'high'; score: number } {
  // Score from 0-100 where lower = better opportunity
  // Factors: fewer channels = better, higher views/subs ratio = better

  let score = 50; // Start at medium

  // Channel count factor (fewer = lower score = better)
  if (channelCount < 10) score -= 30;
  else if (channelCount < 20) score -= 20;
  else if (channelCount < 30) score -= 10;
  else if (channelCount > 40) score += 15;
  else if (channelCount > 50) score += 25;

  // Views-to-subs ratio factor (higher = lower score = better)
  if (avgViewsToSubsRatio > 3) score -= 25;
  else if (avgViewsToSubsRatio > 2) score -= 15;
  else if (avgViewsToSubsRatio > 1.5) score -= 10;
  else if (avgViewsToSubsRatio < 0.5) score += 20;
  else if (avgViewsToSubsRatio < 1) score += 10;

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine level
  let level: 'low' | 'medium' | 'high';
  if (score < 35) level = 'low';
  else if (score < 65) level = 'medium';
  else level = 'high';

  return { level, score };
}

// Check if channel is a "breakout" - high performance + relatively new
function isBreakoutChannel(viewsToSubsRatio: number, createdAt?: string): boolean {
  if (!createdAt) return viewsToSubsRatio > 2;

  const channelAge = Date.now() - new Date(createdAt).getTime();
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;

  // Breakout = high ratio AND channel less than 2 years old
  return viewsToSubsRatio > 2 && channelAge < twoYearsMs;
}

// Search for channels by topic
async function searchChannels(topic: string, maxResults: number = 50): Promise<string[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'channel');
  url.searchParams.set('q', topic);
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('key', YOUTUBE_API_KEY!);

  console.log(`[niche-analyze] Searching for channels with topic: "${topic}"`);
  const response = await fetch(url.toString());
  const data = await response.json() as any;

  if (data.error) {
    console.error(`[niche-analyze] YouTube API error:`, data.error);
    return [];
  }

  if (!data.items) {
    console.log(`[niche-analyze] No items returned from search`);
    return [];
  }

  console.log(`[niche-analyze] Search returned ${data.items.length} channels`);
  // For type=channel search, the ID is in item.id.channelId (not item.snippet.channelId)
  return data.items.map((item: any) => item.id.channelId || item.snippet.channelId).filter(Boolean);
}

// Get channel details
async function getChannelDetails(channelIds: string[]): Promise<NicheChannel[]> {
  if (channelIds.length === 0) return [];

  const channels: NicheChannel[] = [];
  let skippedHidden = 0;
  let skippedNoVideos = 0;

  // Process in batches of 50 (YouTube API limit)
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);

    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', YOUTUBE_API_KEY!);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (data.error) {
      console.error(`[niche-analyze] YouTube channels API error:`, data.error);
      continue;
    }

    if (!data.items) {
      console.log(`[niche-analyze] No channel details returned`);
      continue;
    }

    console.log(`[niche-analyze] Got details for ${data.items.length} channels`);

    for (const channel of data.items) {
      const subscriberCount = parseInt(channel.statistics.subscriberCount || '0', 10);
      const viewCount = parseInt(channel.statistics.viewCount || '0', 10);
      const videoCount = parseInt(channel.statistics.videoCount || '0', 10);

      // Skip channels with hidden subscriber count or no videos
      if (channel.statistics.hiddenSubscriberCount) {
        skippedHidden++;
        continue;
      }
      if (videoCount === 0) {
        skippedNoVideos++;
        continue;
      }

      const viewsToSubsRatio = subscriberCount > 0
        ? Math.round((viewCount / subscriberCount) * 100) / 100
        : 0;

      channels.push({
        id: channel.id,
        title: channel.snippet.title,
        thumbnailUrl: channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url,
        subscriberCount,
        subscriberCountFormatted: formatNumber(subscriberCount),
        viewCount,
        videoCount,
        viewsToSubsRatio,
        isBreakout: isBreakoutChannel(viewsToSubsRatio, channel.snippet.publishedAt),
        createdAt: channel.snippet.publishedAt,
      });
    }
  }

  console.log(`[niche-analyze] Channels after filtering: ${channels.length} (skipped ${skippedHidden} hidden, ${skippedNoVideos} no videos)`);
  return channels;
}

// Debug endpoint to check config
router.get('/debug', (req: Request, res: Response) => {
  res.json({
    hasApiKey: !!YOUTUBE_API_KEY,
    apiKeyPrefix: YOUTUBE_API_KEY ? YOUTUBE_API_KEY.substring(0, 8) + '...' : 'NOT SET'
  });
});

// Main endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const { topic, subscriberMin, subscriberMax } = req.body;

    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Topic is required' });
    }

    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ success: false, error: 'YouTube API key not configured' });
    }

    console.log(`[niche-analyze] Analyzing niche: "${topic}"`);

    // Step 1: Search for channels in this niche
    const channelIds = await searchChannels(topic.trim(), 50);

    if (channelIds.length === 0) {
      return res.json({
        success: true,
        topic: topic.trim(),
        metrics: {
          channelCount: 0,
          avgSubscribers: 0,
          avgViewsPerVideo: 0,
          avgViewsToSubsRatio: 0,
          saturationLevel: 'low',
          saturationScore: 0,
        },
        channels: [],
      });
    }

    console.log(`[niche-analyze] Found ${channelIds.length} channels, fetching details...`);

    // Step 2: Get channel details
    let channels = await getChannelDetails(channelIds);

    // Step 3: Filter by subscriber range if specified
    if (subscriberMin !== undefined || subscriberMax !== undefined) {
      channels = channels.filter(c => {
        if (subscriberMin !== undefined && c.subscriberCount < subscriberMin) return false;
        if (subscriberMax !== undefined && c.subscriberCount > subscriberMax) return false;
        return true;
      });
    }

    // Step 4: Calculate metrics
    const channelCount = channels.length;

    if (channelCount === 0) {
      return res.json({
        success: true,
        topic: topic.trim(),
        metrics: {
          channelCount: 0,
          avgSubscribers: 0,
          avgViewsPerVideo: 0,
          avgViewsToSubsRatio: 0,
          saturationLevel: 'low',
          saturationScore: 0,
        },
        channels: [],
      });
    }

    const totalSubscribers = channels.reduce((sum, c) => sum + c.subscriberCount, 0);
    const totalViews = channels.reduce((sum, c) => sum + c.viewCount, 0);
    const totalVideos = channels.reduce((sum, c) => sum + c.videoCount, 0);
    const totalViewsToSubsRatio = channels.reduce((sum, c) => sum + c.viewsToSubsRatio, 0);

    const avgSubscribers = Math.round(totalSubscribers / channelCount);
    const avgViewsPerVideo = totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0;
    const avgViewsToSubsRatio = Math.round((totalViewsToSubsRatio / channelCount) * 100) / 100;

    const saturation = calculateSaturation(channelCount, avgViewsToSubsRatio);

    // Step 5: Sort channels by views-to-subs ratio (best first)
    channels.sort((a, b) => b.viewsToSubsRatio - a.viewsToSubsRatio);

    const breakoutCount = channels.filter(c => c.isBreakout).length;
    console.log(`[niche-analyze] Analysis complete. ${channelCount} channels, ${breakoutCount} breakouts, saturation: ${saturation.level}`);

    return res.json({
      success: true,
      topic: topic.trim(),
      metrics: {
        channelCount,
        avgSubscribers,
        avgViewsPerVideo,
        avgViewsToSubsRatio,
        saturationLevel: saturation.level,
        saturationScore: saturation.score,
      },
      channels,
    });

  } catch (error) {
    console.error('[niche-analyze] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze niche',
    });
  }
});

export default router;
