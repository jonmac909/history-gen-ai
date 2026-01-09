/**
 * yt-dlp wrapper for YouTube channel/video metadata
 * More reliable than Invidious API for resolving handles
 */

import YTDlpWrap from 'yt-dlp-wrap';
import path from 'path';
import fs from 'fs';
import os from 'os';

// yt-dlp binary path - will be downloaded on first use
const YTDLP_DIR = path.join(os.tmpdir(), 'ytdlp');
const YTDLP_PATH = path.join(YTDLP_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

let ytDlpInstance: YTDlpWrap | null = null;
let downloadPromise: Promise<void> | null = null;

// Semaphore to limit concurrent yt-dlp executions (prevents rate limiting)
const MAX_CONCURRENT_YTDLP = 3;
let activeYtdlpCalls = 0;
const ytdlpQueue: Array<{ resolve: () => void }> = [];

async function acquireYtdlpSlot(): Promise<void> {
  if (activeYtdlpCalls < MAX_CONCURRENT_YTDLP) {
    activeYtdlpCalls++;
    return;
  }
  // Wait in queue
  return new Promise((resolve) => {
    ytdlpQueue.push({ resolve });
  });
}

function releaseYtdlpSlot(): void {
  activeYtdlpCalls--;
  const next = ytdlpQueue.shift();
  if (next) {
    activeYtdlpCalls++;
    next.resolve();
  }
}

/**
 * Get or initialize yt-dlp instance (downloads binary if needed)
 */
async function getYtDlp(): Promise<YTDlpWrap> {
  if (ytDlpInstance) {
    return ytDlpInstance;
  }

  // Ensure directory exists
  if (!fs.existsSync(YTDLP_DIR)) {
    fs.mkdirSync(YTDLP_DIR, { recursive: true });
  }

  // Download yt-dlp binary if not present
  if (!fs.existsSync(YTDLP_PATH)) {
    if (!downloadPromise) {
      console.log('[ytdlp] Downloading yt-dlp binary...');
      downloadPromise = YTDlpWrap.downloadFromGithub(YTDLP_PATH)
        .then(() => {
          console.log('[ytdlp] yt-dlp binary downloaded successfully');
        })
        .catch((err) => {
          console.error('[ytdlp] Failed to download yt-dlp:', err);
          throw err;
        });
    }
    await downloadPromise;
  }

  ytDlpInstance = new YTDlpWrap(YTDLP_PATH);
  return ytDlpInstance;
}

export interface YtDlpChannelInfo {
  id: string;
  channel: string;
  channel_id: string;
  channel_url: string;
  uploader: string;
  uploader_id: string;
  uploader_url: string;
  channel_follower_count?: number;
  thumbnails?: { url: string; width?: number; height?: number }[];
  // Playlist metadata (channel ID often here when channel_id is null)
  playlist_channel_id?: string;
  playlist_channel?: string;
  playlist_uploader?: string;
  playlist_uploader_id?: string;
}

export interface YtDlpVideoInfo {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  upload_date?: string;
  channel_id?: string;
  channel?: string;
}

/**
 * Resolve a YouTube handle (@handle) or URL to a channel ID
 */
export async function resolveChannelId(input: string): Promise<string> {
  // Already a channel ID (starts with UC and is 24 chars)
  if (input.startsWith('UC') && input.length >= 24) {
    return input.substring(0, 24);
  }

  // Extract from URL patterns
  const channelIdMatch = input.match(/\/channel\/(UC[\w-]{22})/);
  if (channelIdMatch) {
    return channelIdMatch[1];
  }

  // Build a proper YouTube URL for yt-dlp
  let url = input;
  if (!input.includes('youtube.com') && !input.includes('youtu.be')) {
    // Just a handle or name
    const handle = input.replace(/^@/, '');
    url = `https://www.youtube.com/@${handle}`;
  }

  console.log(`[ytdlp] Resolving channel ID from: ${url}`);

  const ytDlp = await getYtDlp();

  // Acquire semaphore slot to limit concurrent calls
  await acquireYtdlpSlot();
  try {
    // Use --dump-single-json to get channel metadata even if default tab has no videos
    const result = await ytDlp.execPromise([
      url,
      '--dump-single-json',
      '--skip-download',
      '--no-warnings',
      '--ignore-errors',
    ]);

    if (!result.trim()) {
      throw new Error('No data returned from yt-dlp');
    }

    const info = JSON.parse(result.trim()) as YtDlpChannelInfo;
    // Check multiple possible locations for channel ID
    const channelId = info.channel_id || info.playlist_channel_id || info.uploader_id;

    if (!channelId || !channelId.startsWith('UC')) {
      console.log('[ytdlp] Raw info keys:', Object.keys(info).filter(k => k.includes('channel') || k.includes('uploader')));
      throw new Error('Could not extract channel ID');
    }

    console.log(`[ytdlp] Resolved channel ID: ${channelId}`);
    return channelId;

  } catch (error: any) {
    console.error('[ytdlp] Error resolving channel:', error.message);
    throw new Error(`Could not find channel: ${input}`);
  } finally {
    releaseYtdlpSlot();
  }
}

/**
 * Get channel videos with metadata
 */
export async function getChannelVideos(
  channelId: string,
  maxResults: number = 50
): Promise<YtDlpVideoInfo[]> {
  const ytDlp = await getYtDlp();
  // Explicitly use /videos tab to get video list
  const url = `https://www.youtube.com/channel/${channelId}/videos`;

  console.log(`[ytdlp] Fetching videos from: ${url}`);

  // Acquire semaphore slot to limit concurrent calls
  await acquireYtdlpSlot();
  try {
    const result = await ytDlp.execPromise([
      url,
      '--dump-json',
      '--flat-playlist',
      '--playlist-items', `1:${maxResults}`,
      '--no-warnings',
      '--ignore-errors',
    ]);

    const lines = result.trim().split('\n').filter(Boolean);
    const videos: YtDlpVideoInfo[] = [];

    for (const line of lines) {
      try {
        const info = JSON.parse(line);
        if (info.id && info.title) {
          videos.push({
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/mqdefault.jpg`,
            duration: info.duration,
            view_count: info.view_count,
            like_count: info.like_count,
            upload_date: info.upload_date,
            channel_id: info.channel_id || info.playlist_channel_id || channelId,
            channel: info.channel || info.playlist_channel || info.uploader || info.playlist_uploader,
          });
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    console.log(`[ytdlp] Found ${videos.length} videos`);
    return videos;

  } catch (error: any) {
    console.error('[ytdlp] Error fetching videos:', error.message);
    throw new Error('Failed to fetch channel videos');
  } finally {
    releaseYtdlpSlot();
  }
}

/**
 * Get channel info (subscriber count, etc)
 */
export async function getChannelInfo(channelId: string): Promise<{
  id: string;
  title: string;
  subscriberCount: number;
  thumbnailUrl: string;
}> {
  const ytDlp = await getYtDlp();
  const url = `https://www.youtube.com/channel/${channelId}`;

  console.log(`[ytdlp] Fetching channel info: ${url}`);

  // Acquire semaphore slot to limit concurrent calls
  await acquireYtdlpSlot();
  try {
    // Use --dump-single-json to get channel metadata reliably
    const result = await ytDlp.execPromise([
      url,
      '--dump-single-json',
      '--skip-download',
      '--no-warnings',
      '--ignore-errors',
    ]);

    if (!result.trim()) {
      throw new Error('No data returned');
    }

    const info = JSON.parse(result.trim());

    return {
      id: channelId,
      // Check multiple sources for channel name
      title: info.channel || info.title || info.uploader || 'Unknown Channel',
      subscriberCount: info.channel_follower_count || 0,
      thumbnailUrl: info.thumbnails?.[0]?.url || '',
    };

  } catch (error: any) {
    console.error('[ytdlp] Error fetching channel info:', error.message);
    // Return minimal info if we can't get full details
    return {
      id: channelId,
      title: 'Unknown Channel',
      subscriberCount: 0,
      thumbnailUrl: '',
    };
  } finally {
    releaseYtdlpSlot();
  }
}
