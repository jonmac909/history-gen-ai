import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const router = Router();

// YouTube API configuration
const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

interface YouTubeChannel {
  id: string;
  title: string;
  thumbnailUrl?: string;
}

interface UploadRequest {
  videoUrl: string;
  accessToken: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  publishAt?: string; // ISO 8601 date for scheduled publish
  thumbnailUrl?: string; // URL of custom thumbnail to set
}

interface AuthCodeExchangeRequest {
  code: string;
  redirectUri: string;
}

// Exchange authorization code for tokens
router.post('/auth', async (req: Request, res: Response) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Google OAuth credentials not configured' });
    }

    const { code, redirectUri }: AuthCodeExchangeRequest = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    if (!redirectUri) {
      return res.status(400).json({ error: 'Redirect URI is required' });
    }

    console.log('Exchanging authorization code for tokens...');

    const tokenResponse = await fetch(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      return res.status(400).json({
        error: 'Failed to exchange authorization code',
        details: tokenData.error_description || tokenData.error
      });
    }

    console.log('Token exchange successful');

    // Store refresh token in Supabase for later use
    if (tokenData.refresh_token) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Upsert - update existing or insert new
        const { error } = await supabase
          .from('youtube_tokens')
          .upsert({
            id: '00000000-0000-0000-0000-000000000001', // Single row for single-user app
            refresh_token: tokenData.refresh_token,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

        if (error) {
          console.error('Failed to store refresh token:', error);
          // Don't fail the request, just log the error
        } else {
          console.log('Refresh token stored successfully');
        }
      }
    }

    return res.json({
      success: true,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in, // Usually 3600 seconds (1 hour)
      tokenType: tokenData.token_type,
    });
  } catch (error) {
    console.error('Error in auth code exchange:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to exchange authorization code'
    });
  }
});

// Refresh access token using stored refresh token
router.get('/token', async (req: Request, res: Response) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Google OAuth credentials not configured' });
    }

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    // Get stored refresh token
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('youtube_tokens')
      .select('refresh_token')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();

    if (error || !data?.refresh_token) {
      return res.status(401).json({
        error: 'No stored refresh token found',
        needsAuth: true
      });
    }

    console.log('Refreshing access token...');

    const tokenResponse = await fetch(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: data.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (!tokenResponse.ok) {
      console.error('Token refresh failed:', tokenData);

      // If refresh token is invalid, clear it
      if (tokenData.error === 'invalid_grant') {
        await supabase
          .from('youtube_tokens')
          .delete()
          .eq('id', '00000000-0000-0000-0000-000000000001');
      }

      return res.status(401).json({
        error: 'Failed to refresh access token',
        needsAuth: true,
        details: tokenData.error_description || tokenData.error
      });
    }

    console.log('Access token refreshed successfully');

    return res.json({
      success: true,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to refresh token'
    });
  }
});

// Get list of channels for the authenticated user
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }

    console.log('Fetching YouTube channels...');

    // Fetch channels the user owns or manages
    const response = await fetch(
      `${YOUTUBE_CHANNELS_URL}?part=snippet,contentDetails&mine=true`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch channels:', response.status, errorText);

      if (response.status === 401) {
        return res.status(401).json({ error: 'Access token expired', needsAuth: true });
      }

      return res.status(response.status).json({ error: 'Failed to fetch channels' });
    }

    const data = await response.json() as any;

    const channels: YouTubeChannel[] = (data.items || []).map((item: any) => ({
      id: item.id,
      title: item.snippet?.title || 'Unknown Channel',
      thumbnailUrl: item.snippet?.thumbnails?.default?.url,
    }));

    console.log(`Found ${channels.length} channel(s)`);

    return res.json({ channels });
  } catch (error) {
    console.error('Error fetching channels:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch channels'
    });
  }
});

// Check if we have a valid refresh token stored
router.get('/status', async (req: Request, res: Response) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('youtube_tokens')
      .select('updated_at')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();

    if (error || !data) {
      return res.json({
        authenticated: false,
        message: 'YouTube account not connected'
      });
    }

    return res.json({
      authenticated: true,
      lastUpdated: data.updated_at
    });
  } catch (error) {
    console.error('Error checking auth status:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to check auth status'
    });
  }
});

// Upload video to YouTube with SSE progress
router.post('/', async (req: Request, res: Response) => {
  const {
    videoUrl,
    accessToken,
    title,
    description,
    tags,
    categoryId,
    privacyStatus,
    publishAt,
    thumbnailUrl
  }: UploadRequest = req.body;

  // Validate required fields
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }
  if (!accessToken) {
    return res.status(400).json({ error: 'Access token is required' });
  }
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const heartbeatInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeatInterval);
  };

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Phase 1: Download video from Supabase
    sendEvent({
      type: 'progress',
      stage: 'downloading',
      percent: 5,
      message: 'Downloading video from storage...'
    });

    console.log(`Downloading video from: ${videoUrl}`);

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const videoSize = videoBuffer.length;

    console.log(`Video downloaded: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);

    sendEvent({
      type: 'progress',
      stage: 'downloading',
      percent: 20,
      message: `Video downloaded (${(videoSize / 1024 / 1024).toFixed(1)} MB)`
    });

    // Phase 2: Initialize resumable upload
    sendEvent({
      type: 'progress',
      stage: 'initializing',
      percent: 25,
      message: 'Initializing YouTube upload...'
    });

    // Build video metadata
    const videoMetadata: any = {
      snippet: {
        title: title.substring(0, 100), // YouTube title limit
        description: description || '',
        tags: tags || [],
        categoryId: categoryId || '22', // Default: People & Blogs
      },
      status: {
        privacyStatus: privacyStatus || 'private',
        selfDeclaredMadeForKids: false,
      }
    };

    // Add scheduled publish time if provided
    if (publishAt && privacyStatus === 'private') {
      videoMetadata.status.publishAt = publishAt;
    }

    console.log('Initializing resumable upload with metadata:', JSON.stringify(videoMetadata, null, 2));

    const initResponse = await fetch(
      `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': String(videoSize),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(videoMetadata),
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error('YouTube upload init failed:', initResponse.status, errorText);

      // Check for specific errors
      if (initResponse.status === 401) {
        throw new Error('YouTube authentication expired. Please reconnect your account.');
      }
      if (initResponse.status === 403) {
        throw new Error('YouTube upload permission denied. Please check your account permissions.');
      }

      throw new Error(`YouTube upload initialization failed: ${initResponse.status}`);
    }

    const uploadUrl = initResponse.headers.get('location');
    if (!uploadUrl) {
      throw new Error('No upload URL returned from YouTube');
    }

    console.log('Resumable upload initialized, upload URL received');

    sendEvent({
      type: 'progress',
      stage: 'uploading',
      percent: 30,
      message: 'Uploading to YouTube...'
    });

    // Phase 3: Upload video in chunks with progress
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    let uploadedBytes = 0;

    while (uploadedBytes < videoSize) {
      const chunkStart = uploadedBytes;
      const chunkEnd = Math.min(uploadedBytes + CHUNK_SIZE, videoSize);
      const chunk = videoBuffer.slice(chunkStart, chunkEnd);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${chunkStart}-${chunkEnd - 1}/${videoSize}`,
        },
        body: chunk,
      });

      if (uploadResponse.status === 308) {
        // Resume incomplete - continue uploading
        const rangeHeader = uploadResponse.headers.get('range');
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=0-(\d+)/);
          if (match) {
            uploadedBytes = parseInt(match[1], 10) + 1;
          } else {
            uploadedBytes = chunkEnd;
          }
        } else {
          uploadedBytes = chunkEnd;
        }
      } else if (uploadResponse.ok) {
        // Upload complete
        uploadedBytes = videoSize;

        const result = await uploadResponse.json() as any;
        const videoId = result.id;

        console.log('YouTube upload complete:', videoId);

        // If thumbnail URL provided, upload it
        if (thumbnailUrl) {
          sendEvent({
            type: 'progress',
            stage: 'uploading',
            percent: 96,
            message: 'Uploading thumbnail...'
          });

          try {
            // Download thumbnail image
            const thumbResponse = await fetch(thumbnailUrl);
            if (thumbResponse.ok) {
              const thumbBuffer = Buffer.from(await thumbResponse.arrayBuffer());
              const contentType = thumbResponse.headers.get('content-type') || 'image/png';

              // Upload thumbnail to YouTube
              const thumbUploadResponse = await fetch(
                `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': contentType,
                    'Content-Length': String(thumbBuffer.length),
                  },
                  body: thumbBuffer,
                }
              );

              if (thumbUploadResponse.ok) {
                console.log('Thumbnail uploaded successfully');
              } else {
                const thumbError = await thumbUploadResponse.text();
                console.error('Thumbnail upload failed:', thumbUploadResponse.status, thumbError);
                // Don't fail the whole upload, just log the error
              }
            } else {
              console.error('Failed to download thumbnail:', thumbResponse.status);
            }
          } catch (thumbError) {
            console.error('Thumbnail upload error:', thumbError);
            // Don't fail the whole upload, just log the error
          }
        }

        sendEvent({
          type: 'progress',
          stage: 'complete',
          percent: 100,
          message: 'Upload complete!'
        });

        sendEvent({
          type: 'complete',
          success: true,
          videoId: videoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
          studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
        });

        cleanup();
        return res.end();
      } else {
        const errorText = await uploadResponse.text();
        console.error('Chunk upload failed:', uploadResponse.status, errorText);
        throw new Error(`Upload failed at ${Math.round(uploadedBytes / videoSize * 100)}%: ${uploadResponse.status}`);
      }

      // Update progress
      const percent = 30 + Math.round((uploadedBytes / videoSize) * 65);
      sendEvent({
        type: 'progress',
        stage: 'uploading',
        percent,
        message: `Uploading... ${Math.round(uploadedBytes / videoSize * 100)}%`
      });
    }

  } catch (error) {
    console.error('YouTube upload error:', error);
    sendEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'YouTube upload failed'
    });
    cleanup();
    res.end();
  }
});

// Disconnect YouTube account (revoke and delete stored token)
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the refresh token first
    const { data } = await supabase
      .from('youtube_tokens')
      .select('refresh_token')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();

    // Try to revoke the token with Google
    if (data?.refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${data.refresh_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      } catch (e) {
        // Ignore revocation errors
        console.log('Token revocation failed (may already be revoked)');
      }
    }

    // Delete the stored token
    await supabase
      .from('youtube_tokens')
      .delete()
      .eq('id', '00000000-0000-0000-0000-000000000001');

    console.log('YouTube account disconnected');

    return res.json({ success: true, message: 'YouTube account disconnected' });
  } catch (error) {
    console.error('Error disconnecting YouTube:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to disconnect YouTube account'
    });
  }
});

export default router;
