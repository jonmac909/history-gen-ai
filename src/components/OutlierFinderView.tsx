import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, TrendingUp, X, LayoutGrid, Compass, Flame, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OutlierVideoCard } from "./OutlierVideoCard";
import { getChannelOutliers, analyzeNiche, OutlierVideo, ChannelStats, NicheChannel, NicheMetrics } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface OutlierFinderViewProps {
  onBack: () => void;
  onSelectVideo: (videoUrl: string, title: string) => void;
}

interface SavedChannel {
  id: string;
  title: string;
  thumbnailUrl: string;
  subscriberCountFormatted: string;
  averageViews: number;
  averageViewsFormatted: string;
  input: string;
  savedAt: number;
}

interface VideoWithChannel extends OutlierVideo {
  channelTitle: string;
  channelSubscribers: string;
  channelAverageViews: number;
  channelAverageViewsFormatted: string;
}

type SortOption = 'outlier' | 'views' | 'uploaded';
type DateRangeOption = 'all' | '7d' | '30d' | '90d' | '1y';
type DurationOption = 'all' | 'short' | 'medium' | 'long';

interface Filters {
  dateRange: DateRangeOption;
  duration: DurationOption;
  minViews: number;
  onlyPositiveOutliers: boolean;
}

const SAVED_CHANNELS_KEY = 'outlier-finder-saved-channels';

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

const DATE_RANGE_LABELS: Record<DateRangeOption, string> = {
  'all': 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
};

const DURATION_LABELS: Record<DurationOption, string> = {
  'all': 'Any duration',
  'short': 'Shorts (<60s)',
  'medium': 'Medium (1-20 min)',
  'long': 'Long (>20 min)',
};

function loadSavedChannels(): SavedChannel[] {
  try {
    const saved = localStorage.getItem(SAVED_CHANNELS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveSavedChannels(channels: SavedChannel[]) {
  localStorage.setItem(SAVED_CHANNELS_KEY, JSON.stringify(channels));
}

// Filter helper functions
function filterByDateRange(video: OutlierVideo, dateRange: DateRangeOption): boolean {
  if (dateRange === 'all') return true;
  const now = new Date();
  const publishedAt = new Date(video.publishedAt);
  const diffDays = Math.floor((now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24));
  switch (dateRange) {
    case '7d': return diffDays <= 7;
    case '30d': return diffDays <= 30;
    case '90d': return diffDays <= 90;
    case '1y': return diffDays <= 365;
    default: return true;
  }
}

function filterByDuration(video: OutlierVideo, duration: DurationOption): boolean {
  if (duration === 'all') return true;
  const seconds = video.durationSeconds || 0;
  switch (duration) {
    case 'short': return seconds < 60;
    case 'medium': return seconds >= 60 && seconds <= 1200;
    case 'long': return seconds > 1200;
    default: return true;
  }
}

export function OutlierFinderView({ onBack, onSelectVideo }: OutlierFinderViewProps) {
  const [channelInput, setChannelInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [channel, setChannel] = useState<ChannelStats | null>(null);
  const [videos, setVideos] = useState<OutlierVideo[]>([]);
  const [allVideos, setAllVideos] = useState<VideoWithChannel[]>([]);
  const [viewingAll, setViewingAll] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [sortBy, setSortBy] = useState<SortOption>('uploaded');
  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([]);
  const [filters, setFilters] = useState<Filters>({
    dateRange: 'all',
    duration: 'all',
    minViews: 0,
    onlyPositiveOutliers: false,
  });

  // Niche mode state
  const [nicheMode, setNicheMode] = useState(false);
  const [nicheMetrics, setNicheMetrics] = useState<NicheMetrics | null>(null);
  const [nicheChannels, setNicheChannels] = useState<NicheChannel[]>([]);
  const [nicheTopic, setNicheTopic] = useState('');

  // Load saved channels on mount
  useEffect(() => {
    setSavedChannels(loadSavedChannels());
  }, []);

  // Apply filters to videos
  const filteredVideos = useMemo(() => {
    let filtered = videos;
    filtered = filtered.filter(v => filterByDateRange(v, filters.dateRange));
    filtered = filtered.filter(v => filterByDuration(v, filters.duration));
    if (filters.minViews > 0) {
      filtered = filtered.filter(v => v.viewCount >= filters.minViews);
    }
    if (filters.onlyPositiveOutliers) {
      filtered = filtered.filter(v => v.isPositiveOutlier);
    }
    return filtered;
  }, [videos, filters]);

  // Apply filters to all videos (view all mode)
  const filteredAllVideos = useMemo(() => {
    let filtered = allVideos;
    filtered = filtered.filter(v => filterByDateRange(v, filters.dateRange));
    filtered = filtered.filter(v => filterByDuration(v, filters.duration));
    if (filters.minViews > 0) {
      filtered = filtered.filter(v => v.viewCount >= filters.minViews);
    }
    if (filters.onlyPositiveOutliers) {
      filtered = filtered.filter(v => v.isPositiveOutlier);
    }
    return filtered;
  }, [allVideos, filters]);

  // Check if any filters are active
  const hasActiveFilters = filters.dateRange !== 'all' || filters.duration !== 'all' || filters.minViews > 0 || filters.onlyPositiveOutliers;

  const handleAnalyze = async (input?: string) => {
    const channelToAnalyze = input || channelInput.trim();
    if (!channelToAnalyze) {
      toast({
        title: "Enter a channel",
        description: "Please enter a YouTube channel URL or @handle",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setChannel(null);
    setVideos([]);
    setViewingAll(false);

    try {
      const result = await getChannelOutliers(channelToAnalyze, 50, sortBy);

      if (!result.success) {
        toast({
          title: "Analysis failed",
          description: result.error || "Could not analyze this channel",
          variant: "destructive",
        });
        return;
      }

      if (result.channel) {
        setChannel(result.channel);
        // Save to recent channels
        const newSaved: SavedChannel = {
          id: result.channel.id,
          title: result.channel.title,
          thumbnailUrl: result.channel.thumbnailUrl,
          subscriberCountFormatted: result.channel.subscriberCountFormatted,
          averageViews: result.channel.averageViews,
          averageViewsFormatted: result.channel.averageViewsFormatted,
          input: channelToAnalyze,
          savedAt: Date.now(),
        };
        const existing = savedChannels.filter(c => c.id !== result.channel!.id);
        const updated = [newSaved, ...existing]; // No limit on saved channels
        setSavedChannels(updated);
        saveSavedChannels(updated);
      }
      if (result.videos) {
        setVideos(result.videos);
      }

      toast({
        title: "Analysis complete",
        description: `Found ${result.videos?.length || 0} videos from ${result.channel?.title}`,
      });
    } catch (error) {
      console.error('Outlier analysis error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to analyze channel",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewAll = async () => {
    if (savedChannels.length === 0) {
      toast({
        title: "No saved channels",
        description: "Analyze some channels first to use View All",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setChannel(null);
    setVideos([]);
    setViewingAll(true);

    const allResults: VideoWithChannel[] = [];

    try {
      // Process channels SEQUENTIALLY to respect TubeLab rate limit (10 req/min)
      // Each channel may use 2 API calls (channel search + outliers), so 6s delay = safe
      const CHANNEL_DELAY_MS = 6500; // 6.5 seconds between channels

      setLoadingProgress({ current: 0, total: savedChannels.length });

      for (let i = 0; i < savedChannels.length; i++) {
        const saved = savedChannels[i];
        setLoadingProgress({ current: i + 1, total: savedChannels.length });

        try {
          // forceRefresh=true to always fetch fresh videos from TubeLab and update cache
          const result = await getChannelOutliers(saved.input, 20, 'uploaded', true);
          if (result.success && result.videos && result.channel) {
            const videos = result.videos.map(v => ({
              ...v,
              channelTitle: result.channel!.title,
              channelSubscribers: result.channel!.subscriberCountFormatted,
              channelAverageViews: result.channel!.averageViews,
              channelAverageViewsFormatted: result.channel!.averageViewsFormatted,
            }));
            allResults.push(...videos);
          }
        } catch {
          // Skip failed channels silently
        }

        // Wait before next channel (unless this is the last one)
        if (i < savedChannels.length - 1) {
          await new Promise(resolve => setTimeout(resolve, CHANNEL_DELAY_MS));
        }
      }

      // Sort by selected option
      if (sortBy === 'outlier') {
        allResults.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
      } else if (sortBy === 'views') {
        allResults.sort((a, b) => b.viewCount - a.viewCount);
      } else {
        allResults.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      }

      setAllVideos(allResults);

      toast({
        title: "View All complete",
        description: `Found ${allResults.length} videos from ${savedChannels.length} channels`,
      });
    } catch (error) {
      console.error('View all error:', error);
      toast({
        title: "Error",
        description: "Failed to fetch videos from all channels",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeNiche = async () => {
    const topic = channelInput.trim();
    if (!topic) {
      toast({
        title: "Enter a topic",
        description: "Please enter a niche topic to analyze (e.g., 'medieval history')",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setNicheMode(true);
    setNicheMetrics(null);
    setNicheChannels([]);
    setChannel(null);
    setVideos([]);
    setViewingAll(false);

    try {
      const result = await analyzeNiche(topic);

      if (!result.success) {
        toast({
          title: "Analysis failed",
          description: result.error || "Could not analyze this niche",
          variant: "destructive",
        });
        return;
      }

      setNicheTopic(result.topic);
      setNicheMetrics(result.metrics);
      setNicheChannels(result.channels);

      toast({
        title: "Niche analysis complete",
        description: `Found ${result.channels.length} channels in "${result.topic}"`,
      });
    } catch (error) {
      console.error('Niche analysis error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to analyze niche",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNicheChannelClick = async (nicheChannel: NicheChannel) => {
    // Analyze this channel's videos using existing flow
    setChannelInput(nicheChannel.id);
    setNicheMode(false);
    setNicheMetrics(null);
    setNicheChannels([]);
    await handleAnalyze(nicheChannel.id);
  };

  const handleSaveNicheChannel = (nicheChannel: NicheChannel, e: React.MouseEvent) => {
    e.stopPropagation();
    // Check if already saved
    if (savedChannels.some(c => c.id === nicheChannel.id)) {
      toast({
        title: "Already saved",
        description: `${nicheChannel.title} is already in your saved channels`,
      });
      return;
    }
    // Add to saved channels
    const newSaved: SavedChannel = {
      id: nicheChannel.id,
      title: nicheChannel.title,
      thumbnailUrl: nicheChannel.thumbnailUrl,
      subscriberCountFormatted: nicheChannel.subscriberCountFormatted,
      averageViews: Math.round(nicheChannel.viewCount / nicheChannel.videoCount),
      averageViewsFormatted: formatNumber(Math.round(nicheChannel.viewCount / nicheChannel.videoCount)),
      input: nicheChannel.id,
      savedAt: Date.now(),
    };
    const updated = [newSaved, ...savedChannels];
    setSavedChannels(updated);
    saveSavedChannels(updated);
    toast({
      title: "Channel saved",
      description: `${nicheChannel.title} added to your channels`,
    });
  };

  const handleSort = (newSort: SortOption) => {
    if (newSort === sortBy) return;
    setSortBy(newSort);

    // Re-sort locally for immediate feedback
    if (viewingAll && allVideos.length > 0) {
      const sorted = [...allVideos];
      if (newSort === 'outlier') {
        sorted.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
      } else if (newSort === 'views') {
        sorted.sort((a, b) => b.viewCount - a.viewCount);
      } else {
        sorted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      }
      setAllVideos(sorted);
    } else if (videos.length > 0) {
      const sorted = [...videos];
      if (newSort === 'outlier') {
        sorted.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
      } else if (newSort === 'views') {
        sorted.sort((a, b) => b.viewCount - a.viewCount);
      } else {
        sorted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      }
      setVideos(sorted);
    }
  };

  const handleVideoClick = (video: OutlierVideo) => {
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    onSelectVideo(videoUrl, video.title);
  };

  const handleRemoveSavedChannel = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedChannels.filter(c => c.id !== channelId);
    setSavedChannels(updated);
    saveSavedChannels(updated);
  };

  const handleClear = () => {
    setChannel(null);
    setVideos([]);
    setAllVideos([]);
    setViewingAll(false);
    setNicheMode(false);
    setNicheMetrics(null);
    setNicheChannels([]);
    setNicheTopic('');
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            {/* Clickable logo/title to go back */}
            <button
              onClick={onBack}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-gray-900">Outliers</span>
            </button>

            {/* Search bar */}
            <div className="flex-1 flex items-center gap-2">
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="@channel or niche topic..."
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                  className="pl-10 pr-4 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 rounded-full"
                />
              </div>
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => handleSort(e.target.value as SortOption)}
                className="bg-white border border-gray-300 rounded-md px-2 py-1 text-gray-700"
              >
                <option value="uploaded">Uploaded</option>
                <option value="outlier">Outlier Score</option>
                <option value="views">Views</option>
              </select>
            </div>

          </div>
        </div>
      </div>

      {/* Filter panel - always visible */}
      <div className="border-b border-gray-200 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Date:</span>
              <select
                value={filters.dateRange}
                onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as DateRangeOption })}
                className="bg-white border border-gray-300 rounded-md px-2 py-1 text-sm text-gray-700"
              >
                {Object.entries(DATE_RANGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Duration */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Duration:</span>
              <select
                value={filters.duration}
                onChange={(e) => setFilters({ ...filters, duration: e.target.value as DurationOption })}
                className="bg-white border border-gray-300 rounded-md px-2 py-1 text-sm text-gray-700"
              >
                {Object.entries(DURATION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Min views */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Min views:</span>
              <select
                value={filters.minViews}
                onChange={(e) => setFilters({ ...filters, minViews: parseInt(e.target.value) })}
                className="bg-white border border-gray-300 rounded-md px-2 py-1 text-sm text-gray-700"
              >
                <option value={0}>Any</option>
                <option value={1000}>1K+</option>
                <option value={10000}>10K+</option>
                <option value={100000}>100K+</option>
                <option value={1000000}>1M+</option>
              </select>
            </div>

            {/* Only positive outliers */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.onlyPositiveOutliers}
                onChange={(e) => setFilters({ ...filters, onlyPositiveOutliers: e.target.checked })}
                className="rounded border-gray-300 text-red-500 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700">Only outliers (3x+)</span>
            </label>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ dateRange: 'all', duration: 'all', minViews: 0, onlyPositiveOutliers: false })}
                className="text-gray-500 hover:text-gray-700"
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons bar */}
      {!channel && !viewingAll && !nicheMode && !isLoading && (
        <div className="border-b border-gray-200 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button
              onClick={() => handleAnalyze()}
              disabled={!channelInput.trim()}
              className="bg-red-500 hover:bg-red-600 text-white rounded-full px-6"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Analyze Channel
            </Button>
            <Button
              onClick={handleAnalyzeNiche}
              disabled={!channelInput.trim()}
              variant="outline"
              className="rounded-full text-gray-600 border-gray-300"
            >
              <Compass className="h-4 w-4 mr-2" />
              Analyze Niche
            </Button>
            <Button
              onClick={handleViewAll}
              disabled={savedChannels.length === 0}
              variant="outline"
              className="rounded-full text-gray-600 border-gray-300"
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              View All
            </Button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Saved channels list */}
        {!channel && !viewingAll && !nicheMode && !isLoading && savedChannels.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Recent Channels</h2>
            <div className="flex flex-wrap gap-2">
              {savedChannels.map((saved) => (
                <button
                  key={saved.id}
                  onClick={() => {
                    setChannelInput(saved.input);
                    handleAnalyze(saved.input);
                  }}
                  className="group flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <img
                    src={saved.thumbnailUrl}
                    alt={saved.title}
                    className="w-6 h-6 rounded-full"
                  />
                  <span className="text-sm text-gray-700">{saved.title}</span>
                  <span className="text-xs text-gray-400">{saved.subscriberCountFormatted}</span>
                  <button
                    onClick={(e) => handleRemoveSavedChannel(saved.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-gray-300 transition-opacity"
                  >
                    <X className="h-3 w-3 text-gray-500" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Niche Analysis Results */}
        {nicheMode && nicheMetrics && !isLoading && (
          <>
            {/* Niche metrics panel */}
            <div className="mb-6 p-4 bg-gradient-to-r from-orange-50 to-red-50 rounded-xl border border-orange-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-orange-500" />
                  <h2 className="font-semibold text-gray-900">Niche: "{nicheTopic}"</h2>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="text-gray-600"
                >
                  Clear
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{nicheMetrics.channelCount}</div>
                  <div className="text-sm text-gray-500">Channels</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{formatNumber(nicheMetrics.avgSubscribers)}</div>
                  <div className="text-sm text-gray-500">Avg Subscribers</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{nicheMetrics.avgViewsToSubsRatio}x</div>
                  <div className="text-sm text-gray-500">Views/Subs Ratio</div>
                </div>
                <div>
                  <div className={`text-2xl font-bold ${
                    nicheMetrics.saturationLevel === 'low' ? 'text-green-600' :
                    nicheMetrics.saturationLevel === 'medium' ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {nicheMetrics.saturationLevel === 'low' ? '🟢 Low' :
                     nicheMetrics.saturationLevel === 'medium' ? '🟡 Medium' :
                     '🔴 High'}
                  </div>
                  <div className="text-sm text-gray-500">Saturation</div>
                </div>
              </div>
              {nicheMetrics.saturationLevel === 'low' && (
                <div className="mt-3 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                  Good opportunity! Low competition with healthy engagement ratios.
                </div>
              )}
            </div>

            {/* Niche channels grid */}
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-500 mb-3">
                Top Channels ({nicheChannels.length})
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {nicheChannels.map((nicheChannel) => (
                <div
                  key={nicheChannel.id}
                  onClick={() => handleNicheChannelClick(nicheChannel)}
                  className="group bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
                >
                  <div className="flex flex-col items-center text-center">
                    <img
                      src={nicheChannel.thumbnailUrl}
                      alt={nicheChannel.title}
                      className="w-16 h-16 rounded-full mb-3"
                    />
                    <h4 className="font-medium text-gray-900 text-sm line-clamp-2 mb-1">
                      {nicheChannel.title}
                    </h4>
                    <div className="text-xs text-gray-500 mb-2">
                      {nicheChannel.subscriberCountFormatted} subscribers
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-bold ${
                        nicheChannel.viewsToSubsRatio >= 2 ? 'text-orange-500' : 'text-gray-600'
                      }`}>
                        {nicheChannel.viewsToSubsRatio}x
                      </span>
                      {nicheChannel.isBreakout && (
                        <Flame className="h-4 w-4 text-orange-500" title="Breakout channel" />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleSaveNicheChannel(nicheChannel, e)}
                      className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs h-7"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {nicheChannels.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>No channels found in this niche with the current filters</p>
              </div>
            )}
          </>
        )}

        {/* Channel header when analyzing single channel */}
        {channel && !viewingAll && (
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={channel.thumbnailUrl}
                alt={channel.title}
                className="w-10 h-10 rounded-full"
              />
              <div>
                <h2 className="font-semibold text-gray-900">{channel.title}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                  <span>{channel.subscriberCountFormatted} subscribers</span>
                  <span>•</span>
                  <span>Avg: {channel.averageViewsFormatted} ± {channel.standardDeviationFormatted}</span>
                  {channel.positiveOutliersCount > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-green-600">{channel.positiveOutliersCount} outliers</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <span className="text-xs text-gray-500">
                  Showing {filteredVideos.length} of {videos.length}
                </span>
              )}
              <Button
                variant="outline"
                onClick={handleClear}
                className="text-gray-600"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* View All header */}
        {viewingAll && !isLoading && (
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">All Channels</h2>
              <p className="text-sm text-gray-500">
                {hasActiveFilters
                  ? `${filteredAllVideos.length} of ${allVideos.length} videos from ${savedChannels.length} channels`
                  : `${allVideos.length} videos from ${savedChannels.length} channels`
                }
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleClear}
              className="text-gray-600"
            >
              Clear
            </Button>
          </div>
        )}

        {/* Video grid - single channel */}
        {videos.length > 0 && channel && !viewingAll && (
          <>
            {filteredVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredVideos.map((video) => (
                  <OutlierVideoCard
                    key={video.videoId}
                    video={video}
                    averageViews={channel.averageViews}
                    averageViewsFormatted={channel.averageViewsFormatted}
                    channelTitle={channel.title}
                    subscriberCountFormatted={channel.subscriberCountFormatted}
                    onClick={() => handleVideoClick(video)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>No videos match your filters</p>
                <Button
                  variant="link"
                  onClick={() => setFilters({ dateRange: 'all', duration: 'all', minViews: 0, onlyPositiveOutliers: false })}
                  className="text-red-500"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </>
        )}

        {/* Video grid - all channels */}
        {viewingAll && allVideos.length > 0 && (
          <>
            {filteredAllVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredAllVideos.map((video) => (
                  <OutlierVideoCard
                    key={video.videoId}
                    video={video}
                    averageViews={video.channelAverageViews}
                    averageViewsFormatted={video.channelAverageViewsFormatted}
                    channelTitle={video.channelTitle}
                    subscriberCountFormatted={video.channelSubscribers}
                    onClick={() => handleVideoClick(video)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>No videos match your filters</p>
                <Button
                  variant="link"
                  onClick={() => setFilters({ dateRange: 'all', duration: 'all', minViews: 0, onlyPositiveOutliers: false })}
                  className="text-red-500"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!isLoading && !channel && !viewingAll && !nicheMode && savedChannels.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg text-gray-700">Analyze channels or explore niches</p>
            <p className="text-sm mt-2 text-gray-500">Enter a @channel to find outliers, or a topic to analyze the niche</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-red-500" />
            <p className="text-gray-500">
              {nicheMode ? 'Analyzing niche...' : viewingAll
                ? `Loading channel ${loadingProgress.current} of ${loadingProgress.total}...`
                : 'Analyzing channel videos...'}
            </p>
            {viewingAll && loadingProgress.total > 1 && (
              <p className="text-xs text-gray-400 mt-2">
                ~{Math.ceil((loadingProgress.total - loadingProgress.current) * 6.5)} seconds remaining
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
