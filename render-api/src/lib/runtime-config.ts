const splitList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const isProduction = process.env.NODE_ENV === 'production';

export const corsAllowedOrigins = splitList(
  process.env.CORS_ALLOWED_ORIGINS,
  [
    'https://autoaigen.com',
    'https://history-gen-ai.pages.dev',
    'https://historygenai.netlify.app',
    ...(isProduction ? [] : ['http://localhost:8080', 'http://localhost:5173']),
  ]
);

export const apiKeyRequired = process.env.REQUIRE_API_KEY === 'true' || isProduction;
export const internalApiKey = process.env.INTERNAL_API_KEY || '';

export const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
export const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 60);

export const imageGenerationConfig = {
  maxConcurrentJobs: Number(process.env.ZIMAGE_MAX_CONCURRENCY ?? 4),
  pollIntervalMs: Number(process.env.ZIMAGE_POLL_INTERVAL_MS ?? 2000),
  maxPollingTimeMs: Number(process.env.ZIMAGE_POLL_TIMEOUT_MS ?? 15 * 60 * 1000),
  maxRetries: Number(process.env.ZIMAGE_MAX_RETRIES ?? 2),
};

export const allowedAssetHosts = splitList(
  process.env.ALLOWED_ASSET_HOSTS,
  [
    'udqfdeoullsxttqguupz.supabase.co',
    'autoaigen.com',
    'history-gen-ai.pages.dev',
    'historygenai.netlify.app',
  ]
);
