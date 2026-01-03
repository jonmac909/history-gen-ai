import { useState } from "react";
import { ArrowLeft, Search, Loader2, TrendingUp, Eye, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OutlierVideoCard } from "./OutlierVideoCard";
import { getChannelOutliers, OutlierVideo, ChannelStats } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface OutlierFinderViewProps {
  onBack: () => void;
  onSelectVideo: (videoUrl: string, title: string) => void;
}

type SortOption = 'outlier' | 'views' | 'uploaded';

export function OutlierFinderView({ onBack, onSelectVideo }: OutlierFinderViewProps) {
  const [channelInput, setChannelInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [channel, setChannel] = useState<ChannelStats | null>(null);
  const [videos, setVideos] = useState<OutlierVideo[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('outlier');

  const handleAnalyze = async () => {
    if (!channelInput.trim()) {
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

    try {
      const result = await getChannelOutliers(channelInput.trim(), 50, sortBy);

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

  const handleSort = async (newSort: SortOption) => {
    if (newSort === sortBy) return;
    setSortBy(newSort);

    // Re-sort locally for immediate feedback
    if (videos.length > 0) {
      const sorted = [...videos];
      if (newSort === 'outlier') {
        sorted.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
      } else if (newSort === 'views') {
        sorted.sort((a, b) => b.viewCount - a.viewCount);
      } else if (newSort === 'uploaded') {
        sorted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      }
      setVideos(sorted);
    }
  };

  const handleVideoClick = (video: OutlierVideo) => {
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    onSelectVideo(videoUrl, video.title);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Outlier Finder</h1>
          </div>

          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder="Enter YouTube channel URL or @handle..."
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-gray-500 pr-10"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={isLoading || !channelInput.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze'
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Channel header card */}
        {channel && (
          <div className="bg-zinc-900 rounded-lg p-4 mb-6 flex items-center gap-4">
            <img
              src={channel.thumbnailUrl}
              alt={channel.title}
              className="w-16 h-16 rounded-full"
            />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white">{channel.title}</h2>
              <div className="flex gap-4 text-sm text-gray-400 mt-1">
                <span>{channel.subscriberCountFormatted} subscribers</span>
                <span>Avg: {channel.averageViewsFormatted} views</span>
              </div>
            </div>
          </div>
        )}

        {/* Sort controls */}
        {videos.length > 0 && (
          <div className="flex gap-2 mb-4">
            <Button
              variant={sortBy === 'outlier' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSort('outlier')}
              className={sortBy === 'outlier' ? 'bg-red-600 hover:bg-red-700' : 'border-zinc-700 text-gray-400'}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              Outlier
            </Button>
            <Button
              variant={sortBy === 'views' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSort('views')}
              className={sortBy === 'views' ? 'bg-red-600 hover:bg-red-700' : 'border-zinc-700 text-gray-400'}
            >
              <Eye className="h-4 w-4 mr-1" />
              Views
            </Button>
            <Button
              variant={sortBy === 'uploaded' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSort('uploaded')}
              className={sortBy === 'uploaded' ? 'bg-red-600 hover:bg-red-700' : 'border-zinc-700 text-gray-400'}
            >
              <Calendar className="h-4 w-4 mr-1" />
              Newest
            </Button>
          </div>
        )}

        {/* Video grid */}
        {videos.length > 0 && channel && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {videos.map((video) => (
              <OutlierVideoCard
                key={video.videoId}
                video={video}
                averageViews={channel.averageViews}
                averageViewsFormatted={channel.averageViewsFormatted}
                onClick={() => handleVideoClick(video)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !channel && (
          <div className="text-center py-20 text-gray-500">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Enter a YouTube channel to find outlier videos</p>
            <p className="text-sm mt-2">Discover viral content by analyzing view patterns</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-red-500" />
            <p className="text-gray-400">Analyzing channel videos...</p>
          </div>
        )}
      </div>
    </div>
  );
}
