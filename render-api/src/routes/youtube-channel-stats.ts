import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';

const router = Router();

// YouTube API key from environment
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

interface ChannelInfo {
  id: string;
  title: string;
  subscriberCount: number;
  thumbnailUrl: string;
  uploadsPlaylistId: string;
}

interface VideoStats {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: string;
  durationFormatted: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

interface OutlierVideo extends VideoStats {
  outlierMultiplier: number;
  viewsPerSubscriber: number;
  zScore: number;
  isPositiveOutlier: boolean;
  isNegativeOutlier: boolean;
  durationSeconds: number;
}

// Parse ISO 8601 duration to seconds
function parseDurationToSeconds(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  return hours * 3600 + minutes * 60 + seconds;
}

// Parse ISO 8601 duration to formatted string (e.g., "PT5M30S" -> "5:30")
function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

// Resolve channel input (URL, @handle, or ID) to channel ID
async function resolveChannelId(input: string): Promise<string | null> {
  // Clean up input
  input = input.trim();

  // Extract from various URL formats
  // https://www.youtube.com/channel/UC1234567890
  // https://www.youtube.com/@ChannelHandle
  // https://www.youtube.com/c/ChannelName
  // https://www.youtube.com/user/Username

  let channelId: string | null = null;
  let handle: string | null = null;

  // Check if it's a channel ID format (starts with UC)
  if (input.startsWith('UC') && input.length === 24) {
    return input;
  }

  // Parse URL
  if (input.includes('youtube.com') || input.includes('youtu.be')) {
    try {
      const url = new URL(input.startsWith('http') ? input : `https://${input}`);
      const pathname = url.pathname;

      // /channel/UC1234567890
      if (pathname.startsWith('/channel/')) {
        channelId = pathname.split('/channel/')[1].split('/')[0];
        if (channelId) return channelId;
      }

      // /@ChannelHandle
      if (pathname.startsWith('/@')) {
        handle = pathname.split('/@')[1].split('/')[0];
      }

      // /c/ChannelName or /user/Username
      if (pathname.startsWith('/c/') || pathname.startsWith('/user/')) {
        const segments = pathname.split('/');
        handle = segments[2];
      }
    } catch (e) {
      // Not a valid URL, treat as handle
    }
  }

  // If input starts with @, it's a handle
  if (input.startsWith('@')) {
    handle = input.substring(1);
  } else if (!handle && !input.includes('/')) {
    // Plain text, could be a handle
    handle = input;
  }

  // If we have a handle, resolve it via search API
  if (handle) {
    console.log(`[youtube-channel-stats] Resolving handle: @${handle}`);

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'channel');
    searchUrl.searchParams.set('q', handle);
    searchUrl.searchParams.set('maxResults', '1');
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY!);

    const response = await fetch(searchUrl.toString());
    const data = await response.json() as any;

    if (data.items && data.items.length > 0) {
      // For type=channel search, the ID is in item.id.channelId
      channelId = data.items[0].id?.channelId || data.items[0].snippet?.channelId;
      console.log(`[youtube-channel-stats] Resolved @${handle} to channel ID: ${channelId}`);
      return channelId;
    }

    console.error(`[youtube-channel-stats] Could not resolve handle: @${handle}`);
    return null;
  }

  return channelId;
}

// Get channel info including uploads playlist ID
async function getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet,statistics,contentDetails');
  url.searchParams.set('id', channelId);
  url.searchParams.set('key', YOUTUBE_API_KEY!);

  console.log(`[youtube-channel-stats] Fetching channel info for: ${channelId}`);
  const response = await fetch(url.toString());
  const data = await response.json() as any;

  if (data.error) {
    console.error(`[youtube-channel-stats] YouTube API error:`, JSON.stringify(data.error));
    return null;
  }

  if (!data.items || data.items.length === 0) {
    console.error(`[youtube-channel-stats] Channel not found: ${channelId}, response:`, JSON.stringify(data));
    return null;
  }

  const channel = data.items[0];
  return {
    id: channel.id,
    title: channel.snippet.title,
    subscriberCount: parseInt(channel.statistics.subscriberCount || '0', 10),
    thumbnailUrl: channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

// Get videos from uploads playlist
async function getPlaylistVideos(playlistId: string, maxResults: number = 50): Promise<string[]> {
  const videoIds: string[] = [];
  let nextPageToken: string | undefined;

  while (videoIds.length < maxResults) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', Math.min(50, maxResults - videoIds.length).toString());
    url.searchParams.set('key', YOUTUBE_API_KEY!);
    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken);
    }

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (!data.items) break;

    for (const item of data.items) {
      videoIds.push(item.contentDetails.videoId);
    }

    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
  }

  return videoIds;
}

// Get video details and statistics in batches
async function getVideoStats(videoIds: string[]): Promise<VideoStats[]> {
  const videos: VideoStats[] = [];

  // Process in batches of 50 (YouTube API limit)
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,statistics,contentDetails');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', YOUTUBE_API_KEY!);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (!data.items) continue;

    for (const video of data.items) {
      videos.push({
        videoId: video.id,
        title: video.snippet.title,
        thumbnailUrl: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url,
        publishedAt: video.snippet.publishedAt,
        duration: video.contentDetails.duration,
        durationFormatted: formatDuration(video.contentDetails.duration),
        viewCount: parseInt(video.statistics.viewCount || '0', 10),
        likeCount: parseInt(video.statistics.likeCount || '0', 10),
        commentCount: parseInt(video.statistics.commentCount || '0', 10),
      });
    }
  }

  return videos;
}

// Main endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const { channelInput, maxResults = 50, sortBy = 'outlier' } = req.body;

    if (!channelInput) {
      return res.status(400).json({ success: false, error: 'Channel input is required' });
    }

    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ success: false, error: 'YouTube API key not configured' });
    }

    console.log(`[youtube-channel-stats] Analyzing channel: ${channelInput}`);

    // Step 1: Resolve channel ID
    const channelId = await resolveChannelId(channelInput);
    if (!channelId) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Step 2: Get channel info
    const channelInfo = await getChannelInfo(channelId);
    if (!channelInfo) {
      return res.status(404).json({ success: false, error: 'Channel info not found' });
    }

    console.log(`[youtube-channel-stats] Found channel: ${channelInfo.title} (${formatNumber(channelInfo.subscriberCount)} subs)`);

    // Step 3: Get video IDs from uploads playlist
    const videoIds = await getPlaylistVideos(channelInfo.uploadsPlaylistId, maxResults);
    if (videoIds.length === 0) {
      return res.status(404).json({ success: false, error: 'No videos found on this channel' });
    }

    console.log(`[youtube-channel-stats] Fetching stats for ${videoIds.length} videos...`);

    // Step 4: Get video statistics
    const videos = await getVideoStats(videoIds);

    // Step 5: Calculate average views, standard deviation, and outlier metrics
    const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
    const averageViews = Math.round(totalViews / videos.length);

    // Calculate standard deviation for z-score
    const variance = videos.reduce((sum, v) => sum + Math.pow(v.viewCount - averageViews, 2), 0) / videos.length;
    const standardDeviation = Math.sqrt(variance);

    const outlierVideos: OutlierVideo[] = videos.map(video => {
      const outlierMultiplier = averageViews > 0 ? Math.round((video.viewCount / averageViews) * 10) / 10 : 0;
      const zScore = standardDeviation > 0
        ? Math.round(((video.viewCount - averageViews) / standardDeviation) * 100) / 100
        : 0;

      return {
        ...video,
        durationSeconds: parseDurationToSeconds(video.duration),
        outlierMultiplier,
        viewsPerSubscriber: channelInfo.subscriberCount > 0
          ? Math.round((video.viewCount / channelInfo.subscriberCount) * 100) / 100
          : 0,
        zScore,
        // Positive outlier: zScore > 2 or multiplier > 3x
        isPositiveOutlier: zScore > 2 || outlierMultiplier >= 3,
        // Negative outlier: zScore < -1.5 or multiplier < 0.3x
        isNegativeOutlier: zScore < -1.5 || outlierMultiplier < 0.3,
      };
    });

    // Step 6: Sort results
    if (sortBy === 'outlier') {
      outlierVideos.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
    } else if (sortBy === 'views') {
      outlierVideos.sort((a, b) => b.viewCount - a.viewCount);
    } else if (sortBy === 'uploaded') {
      outlierVideos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }

    console.log(`[youtube-channel-stats] Analysis complete. Avg views: ${formatNumber(averageViews)}, Top outlier: ${outlierVideos[0]?.outlierMultiplier}x`);

    // Count positive and negative outliers
    const positiveOutliersCount = outlierVideos.filter(v => v.isPositiveOutlier).length;
    const negativeOutliersCount = outlierVideos.filter(v => v.isNegativeOutlier).length;

    return res.json({
      success: true,
      channel: {
        id: channelInfo.id,
        title: channelInfo.title,
        subscriberCount: channelInfo.subscriberCount,
        subscriberCountFormatted: formatNumber(channelInfo.subscriberCount),
        thumbnailUrl: channelInfo.thumbnailUrl,
        averageViews,
        averageViewsFormatted: formatNumber(averageViews),
        standardDeviation: Math.round(standardDeviation),
        standardDeviationFormatted: formatNumber(Math.round(standardDeviation)),
        positiveOutliersCount,
        negativeOutliersCount,
      },
      videos: outlierVideos,
    });

  } catch (error) {
    console.error('[youtube-channel-stats] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze channel',
    });
  }
});

export default router;
