import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, TrendingUp, X, LayoutGrid, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OutlierVideoCard } from "./OutlierVideoCard";
import { getChannelOutliers, OutlierVideo, ChannelStats } from "@/lib/api";
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
  const [sortBy, setSortBy] = useState<SortOption>('uploaded');
  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    dateRange: 'all',
    duration: 'all',
    minViews: 0,
    onlyPositiveOutliers: false,
  });

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
        const updated = [newSaved, ...existing].slice(0, 10); // Keep last 10
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
      // Fetch videos from all saved channels in parallel
      const promises = savedChannels.map(async (saved) => {
        try {
          const result = await getChannelOutliers(saved.input, 20, 'uploaded');
          if (result.success && result.videos && result.channel) {
            return result.videos.map(v => ({
              ...v,
              channelTitle: result.channel!.title,
              channelSubscribers: result.channel!.subscriberCountFormatted,
              channelAverageViews: result.channel!.averageViews,
              channelAverageViewsFormatted: result.channel!.averageViewsFormatted,
            }));
          }
          return [];
        } catch {
          return [];
        }
      });

      const results = await Promise.all(promises);
      results.forEach(vids => allResults.push(...vids));

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
              <span className="font-semibold text-gray-900">HistoryGen</span>
            </button>

            {/* Search bar */}
            <div className="flex-1 flex items-center gap-2">
              <div className="relative flex-1 max-w-xl">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">@</span>
                <Input
                  type="text"
                  placeholder="Enter channel handle or URL..."
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                  className="pl-8 pr-10 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 rounded-full"
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
            </div>

            {/* Filter button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={`rounded-full ${hasActiveFilters ? 'border-red-500 text-red-500' : 'border-gray-300 text-gray-600'}`}
            >
              <Filter className="h-4 w-4 mr-1" />
              Filters
              {hasActiveFilters && <span className="ml-1 text-xs">•</span>}
              {showFilters ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
            </Button>

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

      {/* Filter panel */}
      {showFilters && (
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
      )}

      {/* Action buttons bar */}
      {!channel && !viewingAll && !isLoading && (
        <div className="border-b border-gray-200 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button
              onClick={() => handleAnalyze()}
              disabled={!channelInput.trim()}
              className="bg-red-500 hover:bg-red-600 text-white rounded-full px-6"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Generate Ideas
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
        {!channel && !viewingAll && !isLoading && savedChannels.length > 0 && (
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
        {!isLoading && !channel && !viewingAll && savedChannels.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg text-gray-700">Enter a YouTube channel to find outlier videos</p>
            <p className="text-sm mt-2 text-gray-500">Discover viral content by analyzing view patterns</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-red-500" />
            <p className="text-gray-500">{viewingAll ? 'Loading videos from all channels...' : 'Analyzing channel videos...'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
