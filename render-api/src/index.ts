import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { initPotProvider } from './lib/pot-provider';
import {
  corsAllowedOrigins,
  apiKeyRequired,
  internalApiKey,
  rateLimitMax,
  rateLimitWindowMs,
} from './lib/runtime-config';
import rewriteScriptRouter from './routes/rewrite-script';
import generateAudioRouter from './routes/generate-audio';
import generateImagesRouter from './routes/generate-images';
import getYoutubeTranscriptRouter from './routes/get-youtube-transcript';
import generateCaptionsRouter from './routes/generate-captions';
import renderVideoRouter from './routes/render-video';
import generateImagePromptsRouter from './routes/generate-image-prompts';
import generateThumbnailsRouter from './routes/generate-thumbnails';
import youtubeUploadRouter from './routes/youtube-upload';
import pronunciationRouter from './routes/pronunciation';
import generateYoutubeMetadataRouter from './routes/generate-youtube-metadata';
import youtubeChannelStatsRouter from './routes/youtube-channel-stats';
import youtubeChannelApifyRouter from './routes/youtube-channel-apify';
import youtubeChannelInvidiousRouter from './routes/youtube-channel-invidious';
import youtubeChannelYtdlpRouter from './routes/youtube-channel-ytdlp';
import nicheAnalyzeRouter from './routes/niche-analyze';
import generateClipPromptsRouter from './routes/generate-clip-prompts';
import generateVideoClipsRouter from './routes/generate-video-clips';
import bulkChannelsRouter from './routes/bulk-channels';
import analyzeThumbnailRouter from './routes/analyze-thumbnail';
import rewriteTitleRouter from './routes/rewrite-title';
import autoCloneRouter from './routes/auto-clone';
import costsRouter from './routes/costs';
import videoAnalysisRouter from './routes/video-analysis';
import visionTestRouter from './routes/vision-test';
import videoEditorRouter from './routes/video-editor';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
const allowedOrigins = new Set(corsAllowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Api-Key']
}));
app.use(express.json({ limit: '50mb' }));

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const rateLimitMiddleware: express.RequestHandler = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const now = Date.now();
  const key = req.ip || 'unknown';
  const bucket = rateBuckets.get(key) ?? { count: 0, resetAt: now + rateLimitWindowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rateLimitWindowMs;
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (bucket.count > rateLimitMax) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  next();
};

const authMiddleware: express.RequestHandler = (req, res, next) => {
  if (!apiKeyRequired) return next();
  if (req.method === 'OPTIONS') return next();

  const openPaths = new Set(['/health', '/']);
  if (openPaths.has(req.path)) return next();

  if (!internalApiKey) {
    return res.status(500).json({ error: 'INTERNAL_API_KEY not configured' });
  }

  const headerToken = req.header('x-internal-api-key') || req.header('X-Internal-Api-Key');
  const bearerToken = req.header('Authorization')?.replace('Bearer ', '');
  const token = headerToken || bearerToken;
  if (!token || token !== internalApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

app.use(rateLimitMiddleware);
app.use(authMiddleware);

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint to check env vars (remove after debugging)
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug-env', (req, res) => {
    res.json({
      proxyConfigured: !!process.env.YTDLP_PROXY_URL,
      proxyUrlLength: process.env.YTDLP_PROXY_URL?.length || 0,
      proxyUrlStart: process.env.YTDLP_PROXY_URL?.substring(0, 10) || 'not set',
      supabaseConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/debug-ytdlp', async (req, res) => {
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');

    const YTDLP_DIR = path.default.join(os.default.tmpdir(), 'ytdlp');
    const YTDLP_PATH = path.default.join(YTDLP_DIR, 'yt-dlp');

    res.json({
      tmpdir: os.default.tmpdir(),
      ytdlpDir: YTDLP_DIR,
      ytdlpPath: YTDLP_PATH,
      dirExists: fs.default.existsSync(YTDLP_DIR),
      binaryExists: fs.default.existsSync(YTDLP_PATH),
      proxyConfigured: !!process.env.YTDLP_PROXY_URL,
      proxyStart: process.env.YTDLP_PROXY_URL?.substring(0, 15) || 'not set'
    });
  });
}

// Root endpoint
app.get('/', (req, res) => {
  console.log('Root endpoint requested');
  res.json({
    message: 'HistoryVidGen API',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/rewrite-script', rewriteScriptRouter);
app.use('/generate-audio', generateAudioRouter);
app.use('/generate-images', generateImagesRouter);
app.use('/get-youtube-transcript', getYoutubeTranscriptRouter);
app.use('/generate-captions', generateCaptionsRouter);
app.use('/render-video', renderVideoRouter);
app.use('/generate-image-prompts', generateImagePromptsRouter);
app.use('/generate-thumbnails', generateThumbnailsRouter);
app.use('/youtube-upload', youtubeUploadRouter);
app.use('/pronunciation', pronunciationRouter);
app.use('/generate-youtube-metadata', generateYoutubeMetadataRouter);
app.use('/youtube-channel-stats', youtubeChannelStatsRouter);
app.use('/youtube-channel-apify', youtubeChannelApifyRouter);
app.use('/youtube-channel-invidious', youtubeChannelInvidiousRouter);
app.use('/youtube-channel-ytdlp', youtubeChannelYtdlpRouter);
app.use('/niche-analyze', nicheAnalyzeRouter);
app.use('/generate-clip-prompts', generateClipPromptsRouter);
app.use('/generate-video-clips', generateVideoClipsRouter);
app.use('/bulk-channels', bulkChannelsRouter);
app.use('/analyze-thumbnail', analyzeThumbnailRouter);
app.use('/rewrite-title', rewriteTitleRouter);
app.use('/auto-clone', autoCloneRouter);
app.use('/costs', costsRouter);
app.use('/video-analysis', videoAnalysisRouter);
app.use('/vision-test', visionTestRouter);
app.use('/video-editor', videoEditorRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Prevent uncaught exceptions from crashing the server
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit - let the error handler deal with it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit - let the error handler deal with it
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HistoryVidGen API running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Server successfully bound and ready for connections`);

  // PO Token provider disabled - requires git clone and npm install at runtime
  // which doesn't work in Railway's container environment
  // initPotProvider().catch(err => {
  //   console.warn('⚠️ PO Token provider init failed:', err.message);
  // });

  // Schedule daily cache refresh at 5am PST = 13:00 UTC (1 hour before Auto Poster)
  // Scrapes fresh videos from all 14+ whitelisted channels
  cron.schedule('0 13 * * *', async () => {
    console.log('[Cron] 🔄 Running daily cache refresh at 13:00 UTC (5am PST)...');
    try {
      const response = await fetch(`http://localhost:${PORT}/auto-clone/refresh-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json() as { success?: boolean; channelsScanned?: number; outliersFound?: number; error?: string };
      console.log('[Cron] Cache refresh:', result.success ? `Done (${result.channelsScanned} channels, ${result.outliersFound} outliers)` : result.error || 'Failed');
    } catch (error) {
      console.error('[Cron] Failed to refresh cache:', error);
    }
  });
  console.log('🔄 Cache refresh scheduled: Daily at 13:00 UTC (5am PST)');

  // Schedule Auto Poster to run daily at 6am PST = 14:00 UTC (no DST adjustment - PST is fixed)
  // Note: During PDT (Mar-Nov), this will be 7am local time. Use 13:00 UTC for 6am PDT.
  cron.schedule('0 14 * * *', async () => {
    console.log('[Cron] 🕕 Checking Auto Poster status at 14:00 UTC (6am PST)...');
    try {
      // Check if cron is enabled
      const statusRes = await fetch(`http://localhost:${PORT}/auto-clone/cron-status`);
      const statusData = await statusRes.json() as { enabled?: boolean };
      
      if (!statusData.enabled) {
        console.log('[Cron] Auto Poster is DISABLED - skipping');
        return;
      }

      console.log('[Cron] Auto Poster is enabled - triggering...');
      const response = await fetch(`http://localhost:${PORT}/auto-clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      console.log('[Cron] Auto Poster triggered:', result.success ? 'Started' : result.error || 'Failed');
    } catch (error) {
      console.error('[Cron] Failed to trigger Auto Poster:', error);
    }
  });
  console.log('⏰ Auto Poster scheduled: Daily at 14:00 UTC (6am PST)');

  // ONE-TIME scheduler: Run Auto Poster for Sumerian Prison video at 03:16 UTC (Jan 13, 2026)
  cron.schedule('16 3 13 1 *', async () => {
    console.log('[Cron] 🎯 ONE-TIME: Running Auto Poster for Sumerian Prison video...');
    try {
      const response = await fetch(`http://localhost:${PORT}/auto-clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          videoUrl: 'https://www.youtube.com/watch?v=GbHa-UiT7NM',
          outlierMultiplier: 8
        }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      console.log('[Cron] ONE-TIME Auto Poster triggered:', result.success ? 'Started' : result.error || 'Failed');
    } catch (error) {
      console.error('[Cron] ONE-TIME Failed to trigger Auto Poster:', error);
    }
  });
  console.log('🎯 ONE-TIME Auto Poster scheduled: 03:16 UTC Jan 13 (Sumerian Prison video)');

});

// Increase timeouts for long-running SSE connections (video rendering)
server.keepAliveTimeout = 620000; // 10+ minutes
server.headersTimeout = 625000; // Slightly higher than keepAliveTimeout
server.timeout = 0; // Disable socket timeout for SSE

server.on('error', (error: any) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});
