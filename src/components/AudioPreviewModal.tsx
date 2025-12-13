import { useState, useRef } from "react";
import { Check, X, Play, Pause, RotateCcw, Volume2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

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
  const audioRef = useRef<HTMLAudioElement>(null);

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
      setAudioDuration(audioRef.current.duration);
    }
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

        <div className="py-6 space-y-4">
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
          />

          {/* Play/Pause Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              variant="outline"
              className="w-20 h-20 rounded-full"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="w-8 h-8" />
              ) : (
                <Play className="w-8 h-8 ml-1" />
              )}
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <Slider
              value={[currentTime]}
              max={audioDuration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="w-full"
            />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onRegenerate} className="mr-auto">
            <RotateCcw className="w-4 h-4 mr-2" />
            Regenerate
          </Button>
          
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          
          <Button onClick={onConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Confirm & Generate Captions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
