import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { initPotProvider } from './lib/pot-provider';
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

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors({
  origin: '*', // Configure this to your frontend domain in production
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint to check env vars (remove after debugging)
app.get('/debug-env', (req, res) => {
  res.json({
    proxyConfigured: !!process.env.YTDLP_PROXY_URL,
    proxyUrlLength: process.env.YTDLP_PROXY_URL?.length || 0,
    proxyUrlStart: process.env.YTDLP_PROXY_URL?.substring(0, 10) || 'not set',
    supabaseConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint - simple check
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

  // Schedule Auto Poster to run daily at 6am PST = 14:00 UTC (no DST adjustment - PST is fixed)
  // Note: During PDT (Mar-Nov), this will be 7am local time. Use 13:00 UTC for 6am PDT.
  cron.schedule('0 14 * * *', async () => {
    console.log('[Cron] 🕕 Running daily Auto Poster at 14:00 UTC (6am PST)...');
    try {
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

  // TEST CRON - DELETE AFTER VERIFICATION - runs at 15:30 UTC
  cron.schedule('30 15 * * *', async () => {
    console.log('[Cron TEST] 🧪 Test cron triggered at 15:30 UTC!');
    try {
      await fetch(`http://localhost:${PORT}/auto-clone/test-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '🧪 Cron test successful! The scheduler is working.' }),
      });
      console.log('[Cron TEST] WhatsApp notification sent');
    } catch (error) {
      console.error('[Cron TEST] Failed:', error);
    }
  });
  console.log('🧪 TEST CRON scheduled: 15:30 UTC (delete after verification)');
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
