import { useState, useEffect, useRef } from "react";
import { Sparkles, Download, Loader2, ChevronLeft, ChevronRight, X, Check } from "lucide-react";
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
import { renderVideoStreaming, type RenderVideoProgress } from "@/lib/api";

interface VisualEffectsModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle?: string;
  audioUrl: string;
  imageUrls: string[];
  imageTimings: { startSeconds: number; endSeconds: number }[];
  srtContent: string;
  existingVideoUrl?: string;  // Pre-rendered video URL with effects (skip rendering if provided)
  onConfirm: (videoUrl: string) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onForward?: () => void;  // Navigate to next step (Thumbnails)
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

export function VisualEffectsModal({
  isOpen,
  projectId,
  projectTitle,
  audioUrl,
  imageUrls,
  imageTimings,
  srtContent,
  existingVideoUrl,
  onConfirm,
  onCancel,
  onBack,
  onSkip,
  onForward,
}: VisualEffectsModalProps) {
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderVideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(existingVideoUrl || null);
  const autoRenderTriggered = useRef(!!existingVideoUrl);

  // Sync with existingVideoUrl prop when it changes or modal opens
  useEffect(() => {
    if (existingVideoUrl) {
      console.log('[VisualEffectsModal] Setting video URL from prop:', existingVideoUrl);
      setVideoUrl(existingVideoUrl);
      autoRenderTriggered.current = true;
    }
  }, [existingVideoUrl]);

  // Also sync when modal opens (in case state was reset)
  useEffect(() => {
    if (isOpen && existingVideoUrl && !videoUrl) {
      console.log('[VisualEffectsModal] Modal opened with existing video, syncing:', existingVideoUrl);
      setVideoUrl(existingVideoUrl);
      autoRenderTriggered.current = true;
    }
  }, [isOpen, existingVideoUrl]);

  // AUTO-START rendering when modal opens (always, unless already have video)
  useEffect(() => {
    if (isOpen && !autoRenderTriggered.current && !videoUrl && !isRendering && !existingVideoUrl) {
      console.log('[VisualEffectsModal] Auto-starting smoke+embers render...');
      autoRenderTriggered.current = true;
      handleRender();
    }
  }, [isOpen, existingVideoUrl]);

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

    try {
      // Render with smoke + embers effects
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
              description: "Your video with smoke + embers effects has been rendered!",
            });
          },
          onCaptionError: (error) => {
            console.warn('Caption error (ignored):', error);
          }
        },
        { embers: false, smoke_embers: true },  // Smoke + embers effects
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
      case 'rendering': return 'Rendering with effects';
      case 'uploading': return 'Uploading video';
      default: return stage;
    }
  };

  // Handle escape key - allow closing when not actively rendering
  const handleEscapeKey = (e: KeyboardEvent) => {
    if (isRendering) {
      e.preventDefault();
    } else {
      onCancel();
    }
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={handleEscapeKey}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-400" />
            {videoUrl ? 'Visual Effects Ready' : 'Adding Visual Effects'}
          </DialogTitle>
          <DialogDescription>
            {videoUrl
              ? 'Your video with smoke + embers effects is ready!'
              : 'Rendering your video with cinematic smoke + embers effects...'}
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
                  Adding smoke + embers effects may take a few minutes...
                </p>
              )}
            </>
          )}

          {/* Loading state before progress starts */}
          {!videoUrl && !renderProgress && isRendering && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Starting effects render...</p>
            </div>
          )}

          {/* Re-render button if needed */}
          {!videoUrl && !renderProgress && !isRendering && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground text-center">
                Render failed or was cancelled. Click to try again.
              </p>
              <Button onClick={handleRender} className="w-full gap-2">
                <Sparkles className="w-4 h-4" />
                Render with Effects
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          {/* Left side: Navigation + Download */}
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} disabled={isRendering && !videoUrl} title="Back to previous step">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" size="icon" onClick={onSkip} disabled={isRendering && !videoUrl} title="Skip to next step">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
            {videoUrl && (
              <Button variant="outline" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            )}
          </div>

          {/* Right side: Exit + Forward/Continue */}
          <Button variant="outline" onClick={onCancel} disabled={isRendering && !videoUrl}>
            <X className="w-4 h-4 mr-2" />
            Exit
          </Button>

          {onForward ? (
            <Button
              onClick={onForward}
              disabled={isRendering && !videoUrl}
            >
              Thumbnails
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={!videoUrl}
            >
              <Check className="w-4 h-4 mr-2" />
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
