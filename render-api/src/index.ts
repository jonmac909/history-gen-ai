import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors({
  origin: '*', // Configure this to your frontend domain in production
  methods: ['GET', 'POST', 'OPTIONS'],
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

// Debug endpoint to test yt-dlp binary (version only - fast)
app.get('/debug-ytdlp', async (req, res) => {
  try {
    const YTDlpWrap = (await import('yt-dlp-wrap')).default;
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');

    const YTDLP_DIR = path.default.join(os.default.tmpdir(), 'ytdlp');
    const YTDLP_PATH = path.default.join(YTDLP_DIR, 'yt-dlp');

    const binaryExists = fs.default.existsSync(YTDLP_PATH);

    if (!binaryExists) {
      fs.default.mkdirSync(YTDLP_DIR, { recursive: true });
      await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
    }

    const ytDlp = new YTDlpWrap(YTDLP_PATH);
    const version = await ytDlp.execPromise(['--version']);

    res.json({
      success: true,
      binaryPath: YTDLP_PATH,
      binaryExists,
      version: version.trim(),
      proxyConfigured: !!process.env.YTDLP_PROXY_URL
    });
  } catch (error: any) {
    res.json({
      success: false,
      error: error.message,
      stderr: error.stderr?.substring(0, 500),
      stdout: error.stdout?.substring(0, 500)
    });
  }
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
