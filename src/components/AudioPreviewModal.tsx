import { useState, useRef, useEffect } from "react";
import { Check, X, Play, Pause, RotateCcw, Volume2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AudioPreviewModalProps {
  isOpen: boolean;
  audioUrl: string;
  duration?: number;
  onConfirm: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}

export function AudioPreviewModal({ 
  isOpen, 
  audioUrl,
  duration,
  onConfirm, 
  onRegenerate,
  onCancel 
}: AudioPreviewModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Reset state when modal opens with new audio
  useEffect(() => {
    if (isOpen && audioUrl) {
      setIsPlaying(false);
      setCurrentTime(0);
      setIsLoading(true);
      setAudioDuration(duration || 0);
    }
  }, [isOpen, audioUrl, duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const realDuration = audioRef.current.duration;
      if (realDuration && isFinite(realDuration) && realDuration > 0) {
        setAudioDuration(realDuration);
      }
      setIsLoading(false);
    }
  };

  const handleCanPlay = () => {
    setIsLoading(false);
  };

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Volume2 className="w-6 h-6 text-primary" />
            Preview Audio
          </DialogTitle>
          <DialogDescription>
            Listen to the generated voiceover and confirm before continuing.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            onEnded={handleEnded}
          />

          {/* Play/Pause Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              variant="outline"
              className="w-20 h-20 rounded-full border-2 hover:bg-primary hover:text-primary-foreground transition-colors"
              onClick={togglePlay}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-8 h-8" />
              ) : (
                <Play className="w-8 h-8 ml-1" />
              )}
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="space-y-3 px-2">
            <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div 
                className="absolute h-full bg-primary rounded-full transition-all"
                style={{ width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
              />
              <input
                type="range"
                min={0}
                max={audioDuration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek([parseFloat(e.target.value)])}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-sm font-medium text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onRegenerate} className="w-full sm:w-auto sm:mr-auto">
            <RotateCcw className="w-4 h-4 mr-2" />
            Regenerate
          </Button>
          
          <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          
          <Button onClick={onConfirm} className="w-full sm:w-auto">
            <Check className="w-4 h-4 mr-2" />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
