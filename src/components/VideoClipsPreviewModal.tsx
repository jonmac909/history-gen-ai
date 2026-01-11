import { useState, useRef } from "react";
import { Check, X, Video, Play, Pause, ChevronLeft, ChevronRight, Download, RefreshCw, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { GeneratedClip, ClipPrompt } from "@/lib/api";

interface VideoClipsPreviewModalProps {
  isOpen: boolean;
  clips: GeneratedClip[];
  clipPrompts: ClipPrompt[];
  onConfirm: () => void;
  onCancel: () => void;
  onBack?: () => void;
  onRegenerate?: (clipIndex: number) => void;
  isRegenerating?: boolean;
  regeneratingIndex?: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface ClipCardProps {
  clip: GeneratedClip;
  prompt?: ClipPrompt;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

function ClipCard({ clip, prompt, onRegenerate, isRegenerating }: ClipCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
  };

  const handleError = () => {
    setHasError(true);
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="relative aspect-video bg-black">
        {hasError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <AlertTriangle className="w-8 h-8 mb-2" />
            <span className="text-sm">Failed to load video</span>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              src={clip.videoUrl}
              className="w-full h-full object-contain"
              onEnded={handleEnded}
              onError={handleError}
              preload="metadata"
            />
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-12 h-12 text-white" />
              ) : (
                <Play className="w-12 h-12 text-white" />
              )}
            </button>
          </>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-primary" />
            <span className="font-medium">Clip {clip.index}</span>
          </div>
          {prompt && (
            <span className="text-xs text-muted-foreground">
              {formatTime(prompt.startSeconds)} - {formatTime(prompt.endSeconds)}
            </span>
          )}
        </div>

        {prompt && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {prompt.sceneDescription}
          </p>
        )}

        {onRegenerate && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="w-full"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isRegenerating ? 'animate-spin' : ''}`} />
            {isRegenerating ? 'Regenerating...' : 'Regenerate'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function VideoClipsPreviewModal({
  isOpen,
  clips,
  clipPrompts,
  onConfirm,
  onCancel,
  onBack,
  onRegenerate,
  isRegenerating = false,
  regeneratingIndex
}: VideoClipsPreviewModalProps) {
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const totalDuration = clips.length * 10; // 10 seconds per clip
  const successCount = clips.filter(c => c.videoUrl).length;
  const failedCount = clips.length - successCount;

  const handlePlayAll = async () => {
    if (isPlayingAll) {
      // Stop all videos
      videoRefs.current.forEach(video => video?.pause());
      setIsPlayingAll(false);
    } else {
      // Play all videos in sequence
      setIsPlayingAll(true);
      for (const video of videoRefs.current) {
        if (video && !video.error) {
          video.currentTime = 0;
          await video.play();
          await new Promise(resolve => {
            video.onended = resolve;
          });
        }
      }
      setIsPlayingAll(false);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    try {
      // Download clips sequentially to avoid overwhelming the browser
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        if (clip.videoUrl) {
          try {
            // Fetch as blob to bypass cross-origin download restrictions
            const response = await fetch(clip.videoUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = clip.filename || `clip_${String(i).padStart(3, '0')}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Small delay between downloads
            if (i < clips.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (err) {
            console.error(`Failed to download clip ${i + 1}:`, err);
          }
        }
      }
    } finally {
      setIsDownloading(false);
    }
  };

  // Find the prompt for each clip
  const getPromptForClip = (clipIndex: number): ClipPrompt | undefined => {
    return clipPrompts.find(p => p.index === clipIndex);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="w-5 h-5" />
            Generate Video Clips
          </DialogTitle>
          <DialogDescription>
            Preview your {clips.length} intro video clips ({totalDuration} seconds total).
            {failedCount > 0 && (
              <span className="text-yellow-500 ml-2">
                {failedCount} clip{failedCount > 1 ? 's' : ''} failed to generate.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="flex items-center gap-4 py-2 border-b">
          <Button
            variant="outline"
            onClick={handlePlayAll}
            disabled={successCount === 0}
          >
            {isPlayingAll ? (
              <>
                <Pause className="w-4 h-4 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-1" />
                Play All
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleDownloadAll}
            disabled={successCount === 0 || isDownloading}
          >
            <Download className={`w-4 h-4 mr-1 ${isDownloading ? 'animate-pulse' : ''}`} />
            {isDownloading ? 'Downloading...' : 'Download All'}
          </Button>

          <div className="flex-1" />

          <span className="text-sm text-muted-foreground">
            {successCount}/{clips.length} clips ready
          </span>
        </div>

        {/* Clips Grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-2">
            {clips.map((clip, index) => (
              <ClipCard
                key={clip.index}
                clip={clip}
                prompt={getPromptForClip(clip.index)}
                onRegenerate={onRegenerate ? () => onRegenerate(clip.index) : undefined}
                isRegenerating={isRegenerating && regeneratingIndex === clip.index}
              />
            ))}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4 mt-4">
          <div className="flex justify-between w-full">
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" onClick={onBack}>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Prompts
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel}>
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button onClick={onConfirm} disabled={successCount === 0}>
                <Check className="w-4 h-4 mr-1" />
                Continue to Images
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
