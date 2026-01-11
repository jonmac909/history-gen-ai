/**
 * Auto-Clone Route - Daily automated video cloning system
 *
 * POST /auto-clone - Trigger daily clone (cron job)
 * GET /auto-clone/status - View run history
 * GET /auto-clone/processed - View processed videos
 * POST /auto-clone/retry/:videoId - Retry a failed video
 */

import { Router, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { runPipeline, getNext5pmPST } from '../lib/pipeline-runner';
import { getChannelVideos, ScrapedVideo } from '../lib/youtube-scraper';
import fetch from 'node-fetch';

const router = Router();

// WhatsApp notification via TextMeBot (https://www.textmebot.com)
async function sendWhatsAppNotification(message: string): Promise<void> {
  const phone = process.env.WHATSAPP_PHONE;
  const apiKey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apiKey) {
    console.log('[AutoClone] WhatsApp notifications not configured (missing WHATSAPP_PHONE or WHATSAPP_API_KEY)');
    return;
  }

  try {
    const encodedMessage = encodeURIComponent(message);
    const url = `https://api.textmebot.com/send.php?recipient=${phone}&apikey=${apiKey}&text=${encodedMessage}`;

    const response = await fetch(url);
    const responseText = await response.text();
    if (response.ok) {
      console.log('[AutoClone] WhatsApp notification sent:', responseText);
    } else {
      console.error(`[AutoClone] WhatsApp notification failed: ${response.status} - ${responseText}`);
    }
  } catch (error) {
    console.error('[AutoClone] WhatsApp notification error:', error);
  }
}

// Minimum video duration for outlier selection (2 hours)
const MIN_DURATION_SECONDS = 7200;

// Days to look back for outliers
const OUTLIER_DAYS = 7;

interface SavedChannel {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
}

interface OutlierVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelId: string;
  channelName: string;
  viewCount: number;
  durationSeconds: number;
  publishedAt: string;
  outlierMultiplier: number;
}

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key);
}

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Check if already ran today
async function checkAlreadyRanToday(supabase: SupabaseClient): Promise<boolean> {
  const today = getTodayDate();
  const { data } = await supabase
    .from('auto_clone_runs')
    .select('id, status')
    .eq('run_date', today)
    .single();

  return !!data;
}

// Create a new run record
async function createRunRecord(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('auto_clone_runs')
    .insert({
      run_date: getTodayDate(),
      status: 'running',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create run record: ${error.message}`);
  return data.id;
}

// Update run record
async function updateRunRecord(
  supabase: SupabaseClient,
  runId: string,
  updates: any
): Promise<void> {
  const { error } = await supabase
    .from('auto_clone_runs')
    .update(updates)
    .eq('id', runId);

  if (error) console.error(`Failed to update run record: ${error.message}`);
}

// Check if video was already processed
async function isVideoProcessed(supabase: SupabaseClient, videoId: string): Promise<boolean> {
  const { data } = await supabase
    .from('processed_videos')
    .select('id')
    .eq('video_id', videoId)
    .single();

  return !!data;
}

// Record processed video
async function recordProcessedVideo(
  supabase: SupabaseClient,
  video: OutlierVideo,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  extras?: {
    projectId?: string;
    clonedTitle?: string;
    youtubeVideoId?: string;
    youtubeUrl?: string;
    errorMessage?: string;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from('processed_videos')
    .upsert({
      video_id: video.videoId,
      channel_id: video.channelId,
      original_title: video.title,
      original_thumbnail_url: video.thumbnailUrl,
      outlier_multiplier: video.outlierMultiplier,
      duration_seconds: video.durationSeconds,
      status,
      project_id: extras?.projectId,
      cloned_title: extras?.clonedTitle,
      youtube_video_id: extras?.youtubeVideoId,
      youtube_url: extras?.youtubeUrl,
      error_message: extras?.errorMessage,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }, { onConflict: 'video_id' })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to record processed video: ${error.message}`);
  return data.id;
}

// Fetch all saved channels
async function fetchSavedChannels(supabase: SupabaseClient): Promise<SavedChannel[]> {
  const { data, error } = await supabase
    .from('saved_channels')
    .select('id, channel_id, channel_name, channel_url')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch saved channels: ${error.message}`);
  return data || [];
}

// Calculate average views for a channel
function calculateAverageViews(videos: ScrapedVideo[]): number {
  if (videos.length === 0) return 0;
  const totalViews = videos.reduce((sum, v) => sum + (v.views || 0), 0);
  return totalViews / videos.length;
}

// Parse relative time like "2 days ago" to check if within cutoff
function isWithinDays(publishedText: string | undefined, days: number): boolean {
  if (!publishedText) return false;

  const text = publishedText.toLowerCase();

  // Check for hours/minutes (definitely recent)
  if (text.includes('hour') || text.includes('minute') || text.includes('second')) {
    return true;
  }

  // Check for days
  const dayMatch = text.match(/(\d+)\s*day/);
  if (dayMatch) {
    return parseInt(dayMatch[1]) <= days;
  }

  // Check for weeks
  const weekMatch = text.match(/(\d+)\s*week/);
  if (weekMatch) {
    return parseInt(weekMatch[1]) * 7 <= days;
  }

  // If it says "month" or "year", it's too old
  if (text.includes('month') || text.includes('year')) {
    return false;
  }

  // Default to false for unknown formats
  return false;
}

// Scan channels for outliers
async function scanForOutliers(channels: SavedChannel[]): Promise<OutlierVideo[]> {
  const allOutliers: OutlierVideo[] = [];

  for (const channel of channels) {
    try {
      console.log(`[AutoClone] Scanning channel: ${channel.channel_name}`);

      // Get recent videos from channel
      const videos = await getChannelVideos(channel.channel_id, 50);

      if (!videos || videos.length === 0) {
        console.log(`[AutoClone] No videos found for ${channel.channel_name}`);
        continue;
      }

      // Calculate average views
      const avgViews = calculateAverageViews(videos);
      if (avgViews === 0) continue;

      // Find outliers (videos with significantly more views than average)
      for (const video of videos) {
        // Skip short videos (less than 2 hours)
        if ((video.duration || 0) < MIN_DURATION_SECONDS) continue;

        // Skip videos not in last 7 days
        if (!isWithinDays(video.publishedText, OUTLIER_DAYS)) continue;

        // Calculate outlier multiplier
        const multiplier = (video.views || 0) / avgViews;

        // Consider it an outlier if 1.5x+ average views
        if (multiplier >= 1.5) {
          allOutliers.push({
            videoId: video.id,
            title: video.title,
            thumbnailUrl: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`,
            channelId: channel.channel_id,
            channelName: channel.channel_name,
            viewCount: video.views || 0,
            durationSeconds: video.duration || 0,
            publishedAt: video.publishedText || '',
            outlierMultiplier: multiplier,
          });
        }
      }
    } catch (error: any) {
      console.error(`[AutoClone] Error scanning channel ${channel.channel_name}: ${error.message}`);
    }
  }

  // Sort by outlier multiplier (highest first)
  allOutliers.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);

  return allOutliers;
}

// Main auto-clone trigger
router.post('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseClient();
  let runId: string | null = null;

  try {
    console.log('[AutoClone] Starting daily auto-clone run...');

    // Check if already ran today (unless force=true)
    const force = req.body.force === true;
    if (!force && await checkAlreadyRanToday(supabase)) {
      return res.status(400).json({
        success: false,
        error: 'Already ran today. Use force=true to run again.',
      });
    }

    // Create run record
    runId = await createRunRecord(supabase);

    // Fetch saved channels
    const channels = await fetchSavedChannels(supabase);
    if (channels.length === 0) {
      await updateRunRecord(supabase, runId, {
        status: 'no_candidates',
        error_message: 'No saved channels found',
        completed_at: new Date().toISOString(),
      });
      return res.status(400).json({
        success: false,
        error: 'No saved channels found. Add channels first.',
      });
    }

    await updateRunRecord(supabase, runId, { channels_scanned: channels.length });

    // Scan for outliers
    console.log(`[AutoClone] Scanning ${channels.length} channels for outliers...`);
    const outliers = await scanForOutliers(channels);

    await updateRunRecord(supabase, runId, { outliers_found: outliers.length });

    if (outliers.length === 0) {
      await updateRunRecord(supabase, runId, {
        status: 'no_candidates',
        error_message: 'No qualifying outliers found (need 2+ hours, 1.5x+ views)',
        completed_at: new Date().toISOString(),
      });
      return res.status(200).json({
        success: true,
        message: 'No qualifying outliers found',
        channelsScanned: channels.length,
      });
    }

    // Find first unprocessed outlier
    let selectedVideo: OutlierVideo | null = null;
    for (const outlier of outliers) {
      if (!await isVideoProcessed(supabase, outlier.videoId)) {
        selectedVideo = outlier;
        break;
      }
    }

    if (!selectedVideo) {
      await updateRunRecord(supabase, runId, {
        status: 'no_candidates',
        error_message: 'All outliers already processed',
        completed_at: new Date().toISOString(),
      });
      return res.status(200).json({
        success: true,
        message: 'All outliers already processed',
        channelsScanned: channels.length,
        outliersFound: outliers.length,
      });
    }

    await updateRunRecord(supabase, runId, { video_selected_id: selectedVideo.videoId });

    console.log(`[AutoClone] Selected video: "${selectedVideo.title}" (${selectedVideo.outlierMultiplier.toFixed(1)}x views)`);

    // Record as processing
    await recordProcessedVideo(supabase, selectedVideo, 'processing');

    // Calculate publish time (5 PM PST)
    const publishAt = getNext5pmPST();
    console.log(`[AutoClone] Scheduled publish: ${publishAt}`);

    // Start pipeline (async - respond immediately)
    res.json({
      success: true,
      message: 'Auto-clone started',
      runId,
      selectedVideo: {
        videoId: selectedVideo.videoId,
        title: selectedVideo.title,
        channel: selectedVideo.channelName,
        outlierMultiplier: selectedVideo.outlierMultiplier,
        duration: Math.round(selectedVideo.durationSeconds / 60) + ' min',
      },
      publishAt,
    });

    // Run pipeline in background
    runPipeline({
      sourceVideoId: selectedVideo.videoId,
      sourceVideoUrl: `https://www.youtube.com/watch?v=${selectedVideo.videoId}`,
      originalTitle: selectedVideo.title,
      originalThumbnailUrl: selectedVideo.thumbnailUrl,
      channelName: selectedVideo.channelName,
      publishAt,
    }, (step, progress, message) => {
      console.log(`[AutoClone] Pipeline ${step}: ${message} (${progress}%)`);
    }).then(async (result) => {
      if (result.success) {
        console.log(`[AutoClone] Pipeline completed! YouTube: ${result.youtubeUrl}`);
        await recordProcessedVideo(supabase, selectedVideo!, 'completed', {
          projectId: result.projectId,
          clonedTitle: result.clonedTitle,
          youtubeVideoId: result.youtubeVideoId,
          youtubeUrl: result.youtubeUrl,
        });
        await updateRunRecord(supabase, runId!, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });

        // Send WhatsApp notification
        await sendWhatsAppNotification(
          `✅ Auto-Clone Complete!\n\n` +
          `📺 "${result.clonedTitle}"\n` +
          `🔗 ${result.youtubeUrl}\n\n` +
          `Original: "${selectedVideo!.title}" (${selectedVideo!.outlierMultiplier.toFixed(1)}x views)`
        );
      } else {
        console.error(`[AutoClone] Pipeline failed: ${result.error}`);
        await recordProcessedVideo(supabase, selectedVideo!, 'failed', {
          projectId: result.projectId,
          errorMessage: result.error,
        });
        await updateRunRecord(supabase, runId!, {
          status: 'failed',
          error_message: result.error,
          completed_at: new Date().toISOString(),
        });

        // Send WhatsApp notification for failure
        await sendWhatsAppNotification(
          `❌ Auto-Clone Failed\n\n` +
          `Video: "${selectedVideo!.title}"\n` +
          `Error: ${result.error}`
        );
      }
    }).catch(async (error) => {
      console.error(`[AutoClone] Pipeline crashed: ${error.message}`);
      await recordProcessedVideo(supabase, selectedVideo!, 'failed', {
        errorMessage: error.message,
      });
      await updateRunRecord(supabase, runId!, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString(),
      });

      // Send WhatsApp notification for crash
      await sendWhatsAppNotification(
        `💥 Auto-Clone Crashed\n\n` +
        `Video: "${selectedVideo!.title}"\n` +
        `Error: ${error.message}`
      );
    });

  } catch (error: any) {
    console.error(`[AutoClone] Error: ${error.message}`);
    if (runId) {
      await updateRunRecord(supabase, runId, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString(),
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get run history
router.get('/status', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const limit = parseInt(req.query.limit as string) || 10;

    const { data, error } = await supabase
      .from('auto_clone_runs')
      .select('*')
      .order('run_date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.json({
      success: true,
      runs: data,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get processed videos
router.get('/processed', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    let query = supabase
      .from('processed_videos')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({
      success: true,
      videos: data,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Retry a failed video
router.post('/retry/:videoId', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const { videoId } = req.params;

    // Get the processed video record
    const { data: video, error } = await supabase
      .from('processed_videos')
      .select('*')
      .eq('video_id', videoId)
      .single();

    if (error || !video) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    if (video.status !== 'failed') {
      return res.status(400).json({
        success: false,
        error: `Video status is '${video.status}', can only retry failed videos`,
      });
    }

    // Reset status to pending
    await supabase
      .from('processed_videos')
      .update({
        status: 'processing',
        error_message: null,
        completed_at: null,
      })
      .eq('video_id', videoId);

    // Calculate publish time
    const publishAt = getNext5pmPST();

    // Start pipeline
    res.json({
      success: true,
      message: 'Retry started',
      videoId,
      publishAt,
    });

    // Run in background
    runPipeline({
      sourceVideoId: video.video_id,
      sourceVideoUrl: `https://www.youtube.com/watch?v=${video.video_id}`,
      originalTitle: video.original_title,
      originalThumbnailUrl: video.original_thumbnail_url,
      publishAt,
    }).then(async (result) => {
      if (result.success) {
        await supabase
          .from('processed_videos')
          .update({
            status: 'completed',
            project_id: result.projectId,
            cloned_title: result.clonedTitle,
            youtube_video_id: result.youtubeVideoId,
            youtube_url: result.youtubeUrl,
            error_message: null,
            completed_at: new Date().toISOString(),
          })
          .eq('video_id', videoId);
      } else {
        await supabase
          .from('processed_videos')
          .update({
            status: 'failed',
            project_id: result.projectId,
            error_message: result.error,
          })
          .eq('video_id', videoId);
      }
    });

  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
