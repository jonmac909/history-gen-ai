import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rewriteScriptRouter from './routes/rewrite-script';
import generateAudioRouter from './routes/generate-audio';
import generateImagesRouter from './routes/generate-images';
import getYoutubeTranscriptRouter from './routes/get-youtube-transcript';
import generateCaptionsRouter from './routes/generate-captions';

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
});

server.on('error', (error: any) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});
