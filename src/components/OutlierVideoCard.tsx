import { OutlierVideo } from "@/lib/api";

interface OutlierVideoCardProps {
  video: OutlierVideo;
  averageViews: number;
  averageViewsFormatted: string;
  channelTitle: string;
  subscriberCountFormatted: string;
  onClick?: () => void;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? 'about 1 month' : `about ${months} months`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? 'about 1 year' : `about ${years} years`;
}

function getOutlierBadgeStyle(multiplier: number): string {
  if (multiplier >= 3) return 'bg-red-500 text-white';
  if (multiplier >= 2) return 'bg-orange-400 text-white';
  if (multiplier >= 1.5) return 'bg-yellow-400 text-gray-900';
  return 'bg-green-500 text-white';
}

export function OutlierVideoCard({ video, averageViewsFormatted, channelTitle, subscriberCountFormatted, onClick }: OutlierVideoCardProps) {
  const viewsFormatted = formatNumber(video.viewCount);
  const timeAgo = formatTimeAgo(video.publishedAt);
  const outlierBadgeStyle = getOutlierBadgeStyle(video.outlierMultiplier);

  return (
    <div
      className="group cursor-pointer"
      onClick={onClick}
    >
      {/* Thumbnail with badges */}
      <div className="relative aspect-video rounded-xl overflow-hidden mb-2">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover"
        />
        {/* Bottom row of badges */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
          {/* Duration badge */}
          <span className="px-1.5 py-0.5 text-xs font-medium bg-black/80 text-white rounded">
            {video.durationFormatted}
          </span>
          {/* Language badge */}
          <span className="px-1.5 py-0.5 text-xs font-medium bg-black/80 text-white rounded">
            English
          </span>
          {/* Estimated revenue badge - green */}
          <span className="px-1.5 py-0.5 text-xs font-medium bg-green-600 text-white rounded">
            $
          </span>
        </div>
      </div>

      {/* Video info */}
      <div className="space-y-1">
        {/* Title */}
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 group-hover:text-blue-600 transition-colors leading-snug">
          {video.title}
        </h3>

        {/* Channel info row */}
        <div className="text-xs text-gray-500">
          <span className="text-blue-600">@{channelTitle.replace(/\s+/g, '')}</span>
          <span className="mx-1">•</span>
          <span>{subscriberCountFormatted} subs</span>
        </div>

        {/* Time ago */}
        <div className="text-xs text-gray-500">
          {timeAgo}
        </div>

        {/* Outlier badge + views comparison row */}
        <div className="flex items-center gap-2 pt-1">
          <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${outlierBadgeStyle}`}>
            {video.outlierMultiplier}x
          </span>
          <span className="text-xs text-gray-600">
            {viewsFormatted} views vs {averageViewsFormatted} avg
          </span>
        </div>
      </div>
    </div>
  );
}
