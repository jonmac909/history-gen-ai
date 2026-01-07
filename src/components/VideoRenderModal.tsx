import { useState, useEffect, useRef } from "react";
import { Video, Download, Loader2, ChevronLeft, ChevronRight, X, Check, Sparkles } from "lucide-react";
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

interface VideoRenderModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle?: string;
  audioUrl: string;
  imageUrls: string[];
  imageTimings: { startSeconds: number; endSeconds: number }[];
  srtContent: string;
  existingBasicVideoUrl?: string;  // Pre-rendered basic video URL
  existingEffectsVideoUrl?: string;  // Pre-rendered effects video URL
  autoRender?: boolean;  // Auto-start rendering when modal opens (for full automation mode)
  onConfirm: (basicVideoUrl: string, effectsVideoUrl: string) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onForward?: () => void;  // Navigate to next step (Thumbnails)
}

type RenderPass = 'idle' | 'pass1' | 'pass2' | 'complete';

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
  existingBasicVideoUrl,
  existingEffectsVideoUrl,
  autoRender = false,
  onConfirm,
  onCancel,
  onBack,
  onSkip,
  onForward,
}: VideoRenderModalProps) {
  console.log('[VideoRenderModal] Props received:', {
    existingBasicVideoUrl,
    existingEffectsVideoUrl,
    isOpen
  });
  // Initialize to 'complete' if we have an existing effects video
  const [currentPass, setCurrentPass] = useState<RenderPass>(existingEffectsVideoUrl ? 'complete' : 'idle');
  const [renderProgress, setRenderProgress] = useState<RenderVideoProgress | null>(null);
  const [basicVideoUrl, setBasicVideoUrl] = useState<string | null>(existingBasicVideoUrl || null);
  const [effectsVideoUrl, setEffectsVideoUrl] = useState<string | null>(existingEffectsVideoUrl || null);
  const [activeTab, setActiveTab] = useState<'basic' | 'effects'>('effects'); // Default to effects tab
  const autoRenderTriggered = useRef(!!existingBasicVideoUrl || !!existingEffectsVideoUrl);

  // Sync with existing video URLs when props change
  useEffect(() => {
    if (existingBasicVideoUrl) {
      setBasicVideoUrl(existingBasicVideoUrl);
    }
    if (existingEffectsVideoUrl) {
      setEffectsVideoUrl(existingEffectsVideoUrl);
      autoRenderTriggered.current = true;
      // Mark as complete so the video player shows
      setCurrentPass('complete');
    }
  }, [existingBasicVideoUrl, existingEffectsVideoUrl]);

  // Also sync when modal opens (in case state was reset)
  useEffect(() => {
    if (isOpen) {
      if (existingBasicVideoUrl && !basicVideoUrl) {
        setBasicVideoUrl(existingBasicVideoUrl);
      }
      if (existingEffectsVideoUrl && !effectsVideoUrl) {
        setEffectsVideoUrl(existingEffectsVideoUrl);
        autoRenderTriggered.current = true;
        // Mark as complete so the video player shows
        setCurrentPass('complete');
      }
    }
  }, [isOpen, existingBasicVideoUrl, existingEffectsVideoUrl]);

  // Auto-start rendering when modal opens (if autoRender=true AND no existing videos)
  useEffect(() => {
    if (isOpen && autoRender && !autoRenderTriggered.current && !effectsVideoUrl && currentPass === 'idle') {
      autoRenderTriggered.current = true;
      handleRenderBothPasses();
    }
  }, [isOpen, autoRender, existingEffectsVideoUrl]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      if (!existingBasicVideoUrl && !existingEffectsVideoUrl) {
        autoRenderTriggered.current = false;
      }
      setBasicVideoUrl(existingBasicVideoUrl || null);
      setEffectsVideoUrl(existingEffectsVideoUrl || null);
      setRenderProgress(null);
      setCurrentPass('idle');
    }
  }, [isOpen, existingBasicVideoUrl, existingEffectsVideoUrl]);

  // Auto-confirm when rendering completes in full automation mode
  const autoConfirmTriggered = useRef(false);
  useEffect(() => {
    if (autoRender && effectsVideoUrl && currentPass === 'complete' && !autoConfirmTriggered.current) {
      autoConfirmTriggered.current = true;
      console.log('[VideoRenderModal] Auto-confirming after both passes complete');
      const timer = setTimeout(() => {
        onConfirm(basicVideoUrl || '', effectsVideoUrl);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoRender, basicVideoUrl, effectsVideoUrl, currentPass, onConfirm]);

  // Reset auto-confirm flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      autoConfirmTriggered.current = false;
    }
  }, [isOpen]);

  // Render both passes sequentially
  const handleRenderBothPasses = async () => {
    // Pass 1: Basic video (no effects)
    setCurrentPass('pass1');
    setRenderProgress({ stage: 'downloading', percent: 0, message: 'Pass 1: Starting basic video render...' });

    try {
      const pass1Result = await renderVideoStreaming(
        projectId,
        audioUrl,
        imageUrls,
        imageTimings,
        srtContent,
        projectTitle || 'HistoryGenAI Export',
        {
          onProgress: (progress) => setRenderProgress({
            ...progress,
            message: `Pass 1: ${progress.message}`,
            percent: Math.round(progress.percent * 0.5) // Pass 1 is 0-50%
          }),
          onVideoReady: (url) => {
            setBasicVideoUrl(url);
            toast({
              title: "Pass 1 Complete",
              description: "Basic video rendered. Starting effects pass...",
            });
          },
          onCaptionError: (error) => {
            console.warn('Caption error (ignored):', error);
          }
        },
        { embers: false, smoke_embers: false },  // No effects for pass 1
        true  // Use CPU rendering
      );

      if (!pass1Result.success || !pass1Result.videoUrl) {
        throw new Error(pass1Result.error || 'Pass 1 failed');
      }

      setBasicVideoUrl(pass1Result.videoUrl);

      // Pass 2: Video with smoke + embers effects
      setCurrentPass('pass2');
      setRenderProgress({ stage: 'downloading', percent: 50, message: 'Pass 2: Starting effects render...' });

      const pass2Result = await renderVideoStreaming(
        projectId,
        audioUrl,
        imageUrls,
        imageTimings,
        srtContent,
        projectTitle || 'HistoryGenAI Export',
        {
          onProgress: (progress) => setRenderProgress({
            ...progress,
            message: `Pass 2: ${progress.message}`,
            percent: 50 + Math.round(progress.percent * 0.5) // Pass 2 is 50-100%
          }),
          onVideoReady: (url) => {
            setEffectsVideoUrl(url);
            toast({
              title: "Render Complete",
              description: "Both video versions are ready!",
            });
          },
          onCaptionError: (error) => {
            console.warn('Caption error (ignored):', error);
          }
        },
        { embers: false, smoke_embers: true },  // Smoke + embers for pass 2
        true  // Use CPU rendering
      );

      if (pass2Result.success && pass2Result.videoUrl) {
        setEffectsVideoUrl(pass2Result.videoUrl);
        setCurrentPass('complete');
      } else {
        throw new Error(pass2Result.error || 'Pass 2 failed');
      }

    } catch (error) {
      console.error('Render error:', error);
      toast({
        title: "Render Failed",
        description: error instanceof Error ? error.message : "Failed to render video. Please try again.",
        variant: "destructive",
      });
      setCurrentPass('idle');
      setRenderProgress(null);
    }
  };

  const handleDownloadBasic = async () => {
    if (!basicVideoUrl) return;
    const filename = (projectTitle || 'video').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50) + '.mp4';
    toast({ title: "Downloading...", description: "Downloading basic video..." });
    try {
      await downloadFromUrl(basicVideoUrl, filename);
      toast({ title: "Download Complete", description: `${filename} downloaded successfully.` });
    } catch (error) {
      toast({ title: "Download Failed", description: "Failed to download video.", variant: "destructive" });
    }
  };

  const handleDownloadEffects = async () => {
    if (!effectsVideoUrl) return;
    const filename = (projectTitle || 'video').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50) + '_effects.mp4';
    toast({ title: "Downloading...", description: "Downloading video with effects..." });
    try {
      await downloadFromUrl(effectsVideoUrl, filename);
      toast({ title: "Download Complete", description: `${filename} downloaded successfully.` });
    } catch (error) {
      toast({ title: "Download Failed", description: "Failed to download video.", variant: "destructive" });
    }
  };

  const handleConfirm = () => {
    if (effectsVideoUrl) {
      onConfirm(basicVideoUrl || '', effectsVideoUrl);
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

  const isRendering = currentPass === 'pass1' || currentPass === 'pass2';
  const hasAnyVideo = basicVideoUrl || effectsVideoUrl;

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
        className="sm:max-w-5xl"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={handleEscapeKey}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            {currentPass === 'complete' ? 'Videos Ready' : isRendering ? 'Rendering Video' : 'Render Video'}
          </DialogTitle>
          <DialogDescription>
            {currentPass === 'complete'
              ? 'Both video versions are ready! Download or continue to thumbnails.'
              : isRendering
                ? `Rendering your video (${currentPass === 'pass1' ? 'Pass 1: Basic' : 'Pass 2: Effects'})...`
                : 'Render your video in two passes: basic video and with smoke + embers effects.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Video Tabs - Only show when we have videos */}
          {hasAnyVideo && currentPass === 'complete' && (
            <div className="space-y-3">
              {/* Tab Buttons */}
              <div className="flex gap-2 border-b">
                <button
                  onClick={() => setActiveTab('effects')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'effects'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Sparkles className="w-4 h-4 inline mr-1" />
                  With Effects
                </button>
                <button
                  onClick={() => setActiveTab('basic')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'basic'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Video className="w-4 h-4 inline mr-1" />
                  Basic
                </button>
              </div>

              {/* Video Player */}
              {activeTab === 'effects' && effectsVideoUrl && (
                <video
                  key={effectsVideoUrl}
                  src={effectsVideoUrl}
                  controls
                  preload="auto"
                  crossOrigin="anonymous"
                  className="w-full rounded-lg border"
                  style={{ maxHeight: '400px' }}
                />
              )}

              {activeTab === 'basic' && basicVideoUrl && (
                <video
                  key={basicVideoUrl}
                  src={basicVideoUrl}
                  controls
                  preload="auto"
                  crossOrigin="anonymous"
                  className="w-full rounded-lg border"
                  style={{ maxHeight: '400px' }}
                />
              )}
            </div>
          )}

          {/* Rendering Progress */}
          {isRendering && renderProgress && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {currentPass === 'pass1' ? 'Pass 1: Basic Video' : 'Pass 2: Adding Effects'}
                  </span>
                  <span className="font-medium">{renderProgress.percent}%</span>
                </div>
                <Progress value={renderProgress.percent} className="h-2" />
              </div>
              <p className="text-sm text-muted-foreground">
                {getStageLabel(renderProgress.stage)}: {renderProgress.message}
              </p>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className={currentPass === 'pass1' ? 'text-primary font-medium' : ''}>
                  Pass 1 {currentPass === 'pass2' || currentPass === 'complete' ? '✓' : ''}
                </span>
                <span>→</span>
                <span className={currentPass === 'pass2' ? 'text-primary font-medium' : ''}>
                  Pass 2 {currentPass === 'complete' ? '✓' : ''}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                This may take several minutes for large videos (200 images ~30-45 min)...
              </p>
            </>
          )}

          {/* Loading state before progress starts */}
          {isRendering && !renderProgress && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Starting render...</p>
            </div>
          )}

          {/* Render button when not rendering */}
          {!isRendering && currentPass !== 'complete' && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h4 className="font-medium text-sm">Two-Pass Rendering</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    <span><strong>Pass 1:</strong> Basic video (no effects)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span><strong>Pass 2:</strong> Video with smoke + embers overlay</span>
                  </li>
                </ul>
              </div>
              <Button onClick={handleRenderBothPasses} className="w-full gap-2">
                <Video className="w-4 h-4" />
                {hasAnyVideo ? 'Re-render Video (2 Passes)' : 'Render Video (2 Passes)'}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          {/* Left side: Navigation + Download */}
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} disabled={isRendering} title="Back to previous step">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" size="icon" onClick={onSkip} disabled={isRendering} title="Skip to next step">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
            {/* Download button - downloads whichever video is on active tab */}
            {hasAnyVideo && currentPass === 'complete' && (
              <Button
                variant="outline"
                onClick={activeTab === 'effects' ? handleDownloadEffects : handleDownloadBasic}
                disabled={activeTab === 'effects' ? !effectsVideoUrl : !basicVideoUrl}
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            )}
          </div>

          {/* Right side: Exit + Continue */}
          <Button variant="outline" onClick={onCancel} disabled={isRendering}>
            <X className="w-4 h-4 mr-2" />
            Exit
          </Button>

          {onForward ? (
            <Button
              onClick={onForward}
              disabled={isRendering || !effectsVideoUrl}
            >
              Thumbnails
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={!effectsVideoUrl}
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
