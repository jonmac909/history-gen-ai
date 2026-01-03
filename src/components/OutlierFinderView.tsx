import { useState, useEffect } from "react";
import { ArrowLeft, Search, Loader2, TrendingUp, Shuffle, Filter, X, LayoutGrid } from "lucide-react";
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

const SAVED_CHANNELS_KEY = 'outlier-finder-saved-channels';

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

export function OutlierFinderView({ onBack, onSelectVideo }: OutlierFinderViewProps) {
  const [channelInput, setChannelInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [channel, setChannel] = useState<ChannelStats | null>(null);
  const [videos, setVideos] = useState<OutlierVideo[]>([]);
  const [allVideos, setAllVideos] = useState<VideoWithChannel[]>([]);
  const [viewingAll, setViewingAll] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('uploaded');
  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([]);

  // Load saved channels on mount
  useEffect(() => {
    setSavedChannels(loadSavedChannels());
  }, []);

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

            {/* Action buttons */}
            <Button variant="ghost" size="icon" className="text-gray-500">
              <Shuffle className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-gray-500">
              <Filter className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

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
                <p className="text-sm text-gray-500">{channel.subscriberCountFormatted} subscribers • Avg: {channel.averageViewsFormatted} views</p>
              </div>
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

        {/* View All header */}
        {viewingAll && !isLoading && (
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">All Channels</h2>
              <p className="text-sm text-gray-500">{allVideos.length} videos from {savedChannels.length} channels</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {videos.map((video) => (
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
        )}

        {/* Video grid - all channels */}
        {viewingAll && allVideos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {allVideos.map((video) => (
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
