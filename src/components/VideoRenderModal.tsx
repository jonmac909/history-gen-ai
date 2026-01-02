import { useState, useEffect, useRef } from "react";
import { Video, Sparkles, Download, Loader2, ChevronLeft, ChevronRight, X } from "lucide-react";
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
import { toast } from "@/hooks/use-toast";
import { renderVideoStreaming, type RenderVideoProgress, type VideoEffects } from "@/lib/api";

interface VideoRenderModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle?: string;
  audioUrl: string;
  imageUrls: string[];
  imageTimings: { startSeconds: number; endSeconds: number }[];
  srtContent: string;
  existingVideoUrl?: string;  // Pre-rendered video URL (skip rendering if provided)
  autoRender?: boolean;  // Auto-start rendering when modal opens (for full automation mode)
  onConfirm: (videoUrl: string) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
}

// Download file from URL
const downloadFromUrl = async (url: string, filename: string) => {
  let downloadUrl = url;
  if (url.includes('supabase.co/storage')) {
    const separator = url.includes('?') ? '&' : '?';
    downloadUrl = `${url}${separator}download=${encodeURIComponent(filename)}`;
  }

  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export function VideoRenderModal({
  isOpen,
  projectId,
  projectTitle,
  audioUrl,
  imageUrls,
  imageTimings,
  srtContent,
  existingVideoUrl,
  autoRender = false,
  onConfirm,
  onCancel,
  onBack,
  onSkip,
}: VideoRenderModalProps) {
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderVideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(existingVideoUrl || null);
  const autoRenderTriggered = useRef(!!existingVideoUrl);

  // Sync with existingVideoUrl prop when it changes
  useEffect(() => {
    if (existingVideoUrl) {
      setVideoUrl(existingVideoUrl);
      autoRenderTriggered.current = true;
    }
  }, [existingVideoUrl]);

  // Auto-start rendering when modal opens (ONLY if autoRender=true AND no existing video)
  useEffect(() => {
    if (isOpen && autoRender && !autoRenderTriggered.current && !videoUrl && !isRendering && !existingVideoUrl) {
      autoRenderTriggered.current = true;
      handleRender();
    }
  }, [isOpen, autoRender, existingVideoUrl]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Only reset if there's no existing video - otherwise keep ref true
      if (!existingVideoUrl) {
        autoRenderTriggered.current = false;
      }
      setVideoUrl(existingVideoUrl || null);
      setRenderProgress(null);
      setIsRendering(false);
    }
  }, [isOpen, existingVideoUrl]);

  const handleRender = async () => {
    setIsRendering(true);
    setRenderProgress({ stage: 'downloading', percent: 0, message: 'Starting...' });

    // Smoke + Embers effects
    const effects: VideoEffects = {
      embers: false,
      smoke_embers: true
    };

    try {
      const result = await renderVideoStreaming(
        projectId,
        audioUrl,
        imageUrls,
        imageTimings,
        srtContent,
        projectTitle || 'HistoryGenAI Export',
        {
          onProgress: (progress) => setRenderProgress(progress),
          onVideoReady: (url) => {
            setVideoUrl(url);
            toast({
              title: "Video Ready",
              description: "Your video with smoke + embers has been rendered!",
            });
          },
          onCaptionError: (error) => {
            console.warn('Caption error (ignored):', error);
          }
        },
        effects,
        true  // Use GPU rendering (faster)
      );

      if (result.success && result.videoUrl) {
        setVideoUrl(result.videoUrl);
      } else {
        toast({
          title: "Render Failed",
          description: result.error || "Failed to render video. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Render video error:', error);
      toast({
        title: "Render Failed",
        description: error instanceof Error ? error.message : "Failed to render video. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = async () => {
    if (!videoUrl) return;

    const filename = (projectTitle || 'video').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50) + '_smoke_embers.mp4';
    toast({
      title: "Downloading...",
      description: "Downloading video with smoke + embers...",
    });

    try {
      await downloadFromUrl(videoUrl, filename);
      toast({
        title: "Download Complete",
        description: `${filename} downloaded successfully.`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download video. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleConfirm = () => {
    if (videoUrl) {
      onConfirm(videoUrl);
    }
  };

  const getStageLabel = (stage: string): string => {
    switch (stage) {
      case 'downloading': return 'Downloading assets';
      case 'preparing': return 'Preparing timeline';
      case 'rendering': return 'Rendering video';
      case 'uploading': return 'Uploading video';
      default: return stage;
    }
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-400" />
            {videoUrl ? 'Video Ready' : 'Rendering Video'}
          </DialogTitle>
          <DialogDescription>
            {videoUrl
              ? 'Your video with smoke + embers effect is ready!'
              : 'Rendering your video with smoke and embers overlay...'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Video Preview Player */}
          {videoUrl && (
            <div className="space-y-3">
              <video
                src={videoUrl}
                controls
                preload="auto"
                crossOrigin="anonymous"
                className="w-full rounded-lg border"
                style={{ maxHeight: '300px' }}
              />

              <Button onClick={handleDownload} variant="outline" className="w-full gap-2">
                <Download className="w-4 h-4" />
                Download Video
              </Button>
            </div>
          )}

          {/* Rendering Progress */}
          {!videoUrl && renderProgress && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {getStageLabel(renderProgress.stage)}
                  </span>
                  <span className="font-medium">{renderProgress.percent}%</span>
                </div>
                <Progress value={renderProgress.percent} className="h-2" />
              </div>
              <p className="text-sm text-muted-foreground">
                {renderProgress.message}
              </p>
              {renderProgress.stage === 'rendering' && (
                <p className="text-xs text-muted-foreground">
                  This may take a few minutes depending on video length...
                </p>
              )}
            </>
          )}

          {/* Loading state before progress starts */}
          {!videoUrl && !renderProgress && isRendering && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Starting render...</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {onBack && (
              <Button variant="outline" onClick={onBack} disabled={isRendering && !videoUrl}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            {onSkip && (
              <Button variant="ghost" onClick={onSkip} disabled={isRendering && !videoUrl}>
                Skip
              </Button>
            )}
          </div>
          <Button
            onClick={handleConfirm}
            disabled={!videoUrl}
            className="w-full sm:w-auto gap-2"
          >
            Continue to YouTube
            <ChevronRight className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
