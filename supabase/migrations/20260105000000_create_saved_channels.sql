-- Saved channels for Outliers feature
-- Persists across all browsers/computers (app-wide, no auth required)

CREATE TABLE IF NOT EXISTS saved_channels (
  id TEXT PRIMARY KEY,  -- YouTube channel ID
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  subscriber_count_formatted TEXT,
  average_views BIGINT DEFAULT 0,
  average_views_formatted TEXT,
  input TEXT NOT NULL,  -- Original input used to find channel (@handle or URL)
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  sort_order INT DEFAULT 0  -- For manual ordering
);

-- Index for sort order
CREATE INDEX IF NOT EXISTS idx_saved_channels_sort_order ON saved_channels(sort_order);

-- RLS - allow public read/write (no auth in this app)
ALTER TABLE saved_channels ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to read saved channels
CREATE POLICY "Anyone can read saved_channels"
  ON saved_channels FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anonymous users to insert saved channels
CREATE POLICY "Anyone can insert saved_channels"
  ON saved_channels FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow anonymous users to update saved channels
CREATE POLICY "Anyone can update saved_channels"
  ON saved_channels FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Allow anonymous users to delete saved channels
CREATE POLICY "Anyone can delete saved_channels"
  ON saved_channels FOR DELETE
  TO anon, authenticated
  USING (true);

-- Pre-populate with default saved channels (history/sleep documentary channels)
INSERT INTO saved_channels (id, title, input, sort_order) VALUES
  ('boring-history-secrets', 'Boring History Secrets', '@BoringHistorySecrets', 1),
  ('sleepnomad', 'SleepNomad', '@SleepNomad', 2),
  ('sleepwise', 'SleepWise', '@SleepWise', 3),
  ('sleep-on-science', 'Sleep On Science', '@SleepOnScience', 4),
  ('the-sleep-room', 'The Sleep Room', '@TheSleepRoom', 5),
  ('forgotten-worlds-for-sleep', 'Forgotten Worlds for Sleep', '@ForgottenWorldsforSleep', 6),
  ('sleepy-science', 'Sleepy Science', '@SleepyScience', 7),
  ('sleepy-time-history', 'Sleepy Time History', '@SleepyTimeHistory', 8),
  ('smarter-while-you-sleep', 'Smarter While You Sleep', '@SmarterWhileYouSleep', 9),
  ('sleepy-history', 'Sleepy History', '@SleepyHistory', 10),
  ('woke-up-history', 'Woke up History', '@WokeupHistory', 11),
  ('historic-sleep', 'Historic Sleep', '@HistoricSleep', 12),
  ('sleepy-history-show', 'Sleepy History Show', '@SleepyHistoryShow', 13),
  ('midnight-historian', 'Midnight Historian', '@MidnightHistorian', 14),
  ('comfy-history', 'Comfy History', '@ComfyHistory', 15),
  ('the-long-shadow', 'The Long Shadow', '@TheLongShadow', 16),
  ('war-historian-sleepy', 'war historian sleepy', '@warhistoriansleepy', 17),
  ('history-at-night', 'History at Night', '@HistoryatNight', 18),
  ('blake-stories', 'Blake Stories', '@BlakeStories', 19),
  ('night-psalms', 'Night Psalms', '@NightPsalms', 20),
  ('sleepless-historian', 'Sleepless Historian', '@SleeplessHistorian', 21),
  ('historian-sleepy', 'Historian Sleepy', '@HistorianSleepy', 22),
  ('slow-history-for-sleep', 'Slow History For Sleep', '@SlowHistoryForSleep', 23),
  ('boring-space', 'Boring Space', '@BoringSpace', 24),
  ('rise-and-fall-america', 'Rise and Fall America', '@RiseandFallAmerica', 25),
  ('economy-rewind', 'Economy Rewind', '@EconomyRewind', 26),
  ('power-inside-you', 'Power Inside You', '@PowerInsideYou', 27),
  ('chilling-lullabies', 'Chilling Lullabies', '@ChillingLullabies', 28),
  ('acronium', 'Acronium', '@Acronium', 29),
  ('british-war-weapons', 'British War Weapons', '@BritishWarWeapons', 30),
  ('battle-memoirs', 'Battle Memoirs', '@BattleMemoirs', 31),
  ('the-world-before-dawn', 'The World Before Dawn', '@TheWorldBeforeDawn', 32),
  ('the-wealth-historian', 'The Wealth Historian', '@TheWealthHistorian', 33),
  ('unclassified-explains', 'Unclassified Explains', '@UnclassifiedExplains', 34),
  ('history-on-walls', 'History On Walls', '@HistoryOnWalls', 35),
  ('sleepy-american-history', 'Sleepy American History', '@SleepyAmericanHistory', 36)
ON CONFLICT (id) DO NOTHING;
