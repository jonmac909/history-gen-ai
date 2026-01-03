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
  return 'bg-gray-200 text-gray-700';
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
      {/* Thumbnail with duration and outlier badge */}
      <div className="relative aspect-video rounded-xl overflow-hidden mb-3">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover"
        />
        {/* Duration badge - bottom left like VidIQ */}
        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 text-xs font-medium bg-black/80 text-white rounded">
          {video.durationFormatted}
        </span>
        {/* Language badge placeholder - like in screenshot */}
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-xs font-medium bg-black/80 text-white rounded">
          English
        </span>
        {/* Outlier multiplier badge - bottom left corner overlapping */}
        <span className={`absolute -bottom-2 left-2 px-2 py-1 text-sm font-bold rounded-lg shadow-md ${outlierBadgeStyle}`}>
          {video.outlierMultiplier}x
        </span>
      </div>

      {/* Video info */}
      <div className="space-y-1">
        {/* Title */}
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 group-hover:text-blue-600 transition-colors leading-tight">
          {video.title}
        </h3>

        {/* Channel info row */}
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="text-blue-600 hover:underline">{channelTitle}</span>
          <span>•</span>
          <span>{subscriberCountFormatted} subs</span>
        </div>

        {/* Time ago */}
        <div className="text-xs text-gray-500">
          {timeAgo}
        </div>

        {/* Views comparison - styled like VidIQ */}
        <div className="text-xs text-gray-600 mt-1">
          {viewsFormatted} views vs {averageViewsFormatted} avg
        </div>

        {/* Action icons row */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
          <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
          <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
