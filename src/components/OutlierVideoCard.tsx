import { OutlierVideo } from "@/lib/api";

interface OutlierVideoCardProps {
  video: OutlierVideo;
  averageViews: number;
  averageViewsFormatted: string;
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
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function getOutlierColor(multiplier: number): string {
  if (multiplier >= 5) return 'bg-red-500';
  if (multiplier >= 3) return 'bg-orange-500';
  if (multiplier >= 2) return 'bg-yellow-500';
  return 'bg-gray-500';
}

export function OutlierVideoCard({ video, averageViews, averageViewsFormatted, onClick }: OutlierVideoCardProps) {
  const viewsFormatted = formatNumber(video.viewCount);
  const timeAgo = formatTimeAgo(video.publishedAt);
  const outlierColor = getOutlierColor(video.outlierMultiplier);

  return (
    <div
      className="group cursor-pointer rounded-lg overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
      onClick={onClick}
    >
      {/* Thumbnail with duration and outlier badge */}
      <div className="relative aspect-video">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover"
        />
        {/* Duration badge */}
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-xs font-medium bg-black/80 text-white rounded">
          {video.durationFormatted}
        </span>
        {/* Outlier multiplier badge */}
        <span className={`absolute top-2 left-2 px-2 py-0.5 text-xs font-bold text-white rounded ${outlierColor}`}>
          {video.outlierMultiplier}x
        </span>
      </div>

      {/* Video info */}
      <div className="p-3">
        {/* Title */}
        <h3 className="text-sm font-medium text-white line-clamp-2 mb-2 group-hover:text-blue-400 transition-colors">
          {video.title}
        </h3>

        {/* Views comparison */}
        <div className="text-xs text-gray-400 mb-1">
          <span className="text-white font-medium">{viewsFormatted}</span>
          {' views vs '}
          <span className="text-gray-500">{averageViewsFormatted} avg</span>
        </div>

        {/* Views per subscriber */}
        {video.viewsPerSubscriber > 0 && (
          <div className="text-xs text-gray-500">
            {video.viewsPerSubscriber.toFixed(2)} views/sub
          </div>
        )}

        {/* Upload time */}
        <div className="text-xs text-gray-500 mt-1">
          {timeAgo}
        </div>
      </div>
    </div>
  );
}
