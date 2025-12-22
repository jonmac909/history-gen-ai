import { useState, useRef, useEffect } from "react";
import { Check, X, Play, Pause, RefreshCw, Volume2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AudioSegment } from "@/lib/api";

interface AudioSegmentsPreviewModalProps {
  isOpen: boolean;
  segments: AudioSegment[];
  onConfirmAll: () => void;
  onRegenerate: (segmentIndex: number) => Promise<void>;
  onCancel: () => void;
  regeneratingIndex: number | null;
}

interface AudioSegmentCardProps {
  segment: AudioSegment;
  isRegenerating: boolean;
  onRegenerate: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AudioSegmentCard({ segment, isRegenerating, onRegenerate }: AudioSegmentCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Reset when segment URL changes (after regeneration)
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setIsLoading(true);
  }, [segment.audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error('Failed to play:', err));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleCanPlay = () => {
    setIsLoading(false);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const newTime = parseFloat(e.target.value);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <audio
        ref={audioRef}
        src={segment.audioUrl}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
        onError={() => setIsLoading(false)}
      />

      <div className="flex items-center justify-between">
        <span className="font-medium text-lg">Segment {segment.index}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="h-8 px-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
          <span className="ml-1 text-sm">{isRegenerating ? 'Regenerating...' : 'Regenerate'}</span>
        </Button>
      </div>

      {/* Audio Player */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="w-10 h-10 rounded-full p-0 flex-shrink-0"
          onClick={togglePlay}
          disabled={isLoading || isRegenerating}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </Button>

        {/* Progress Bar */}
        <div className="flex-1 space-y-1">
          <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="absolute h-full bg-primary rounded-full transition-all"
              style={{ width: `${segment.duration ? (currentTime / segment.duration) * 100 : 0}%` }}
            />
            <input
              type="range"
              min={0}
              max={segment.duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(segment.duration)}</span>
          </div>
        </div>
      </div>

      {/* Segment Text Preview */}
      <p className="text-sm text-muted-foreground line-clamp-2 italic">
        "{segment.text.substring(0, 150)}{segment.text.length > 150 ? '...' : ''}"
      </p>

      {/* Segment Info */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Duration: {formatTime(segment.duration)}</span>
        <span>Size: {formatSize(segment.size)}</span>
      </div>
    </div>
  );
}

export function AudioSegmentsPreviewModal({
  isOpen,
  segments,
  onConfirmAll,
  onRegenerate,
  onCancel,
  regeneratingIndex,
}: AudioSegmentsPreviewModalProps) {
  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Volume2 className="w-6 h-6 text-primary" />
            Preview Audio Segments
          </DialogTitle>
          <DialogDescription>
            Listen to each segment and regenerate any that need improvement.
            Total duration: {formatTime(totalDuration)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {segments.map((segment) => (
            <AudioSegmentCard
              key={segment.index}
              segment={segment}
              isRegenerating={regeneratingIndex === segment.index}
              onRegenerate={() => onRegenerate(segment.index)}
            />
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>

          <Button
            onClick={onConfirmAll}
            className="w-full sm:w-auto"
            disabled={regeneratingIndex !== null}
          >
            <Check className="w-4 h-4 mr-2" />
            Confirm All
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
