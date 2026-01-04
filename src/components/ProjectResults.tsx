import { useState, useEffect } from "react";
import { Download, ChevronLeft, Video, Loader2, Sparkles, Youtube, Square, CheckSquare, LayoutGrid, List } from "lucide-react";
import { PipelineWidget } from "./PipelineWidget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { renderVideoStreaming, type ImagePromptWithTiming, type RenderVideoProgress, type VideoEffects } from "@/lib/api";
import { YouTubeUploadModal } from "./YouTubeUploadModal";
import { checkYouTubeConnection, authenticateYouTube, disconnectYouTube } from "@/lib/youtubeAuth";


export interface GeneratedAsset {
  id: string;
  name: string;
  type: string;
  size: string;
  icon: React.ReactNode;
  url?: string;
  content?: string;
}

// Pipeline step types for approval tracking
type PipelineStep = 'script' | 'audio' | 'captions' | 'prompts' | 'images' | 'thumbnails' | 'render' | 'youtube';

interface ProjectResultsProps {
  sourceUrl: string;
  onNewProject: () => void;
  onBack?: () => void;
  assets: GeneratedAsset[];
  srtContent?: string;
  // Additional props for FCPXML and video export
  imagePrompts?: ImagePromptWithTiming[];
  audioUrl?: string;
  audioDuration?: number;
  projectTitle?: string;
  projectId?: string;
  videoUrl?: string;  // Pre-rendered video URL (basic, from saved project)
  videoUrlCaptioned?: string;  // Pre-rendered captioned video URL (from saved project)
  embersVideoUrl?: string;  // Pre-rendered video URL with embers (from saved project)
  smokeEmbersVideoUrl?: string;  // Pre-rendered video URL with smoke+embers (from saved project)
  onVideoRendered?: (videoUrl: string) => void;  // Callback when video is rendered
  onCaptionedVideoRendered?: (videoUrl: string) => void;  // Callback when captioned video is rendered
  onEmbersVideoRendered?: (videoUrl: string) => void;  // Callback when embers video is rendered
  onSmokeEmbersVideoRendered?: (videoUrl: string) => void;  // Callback when smoke+embers video is rendered
  thumbnails?: string[];  // Generated thumbnails for YouTube upload
  selectedThumbnailIndex?: number;  // Index of previously selected thumbnail
  script?: string;  // Script content for YouTube metadata AI generation
  // Navigation callbacks to go back to specific pipeline steps
  onGoToScript?: () => void;
  onGoToAudio?: () => void;
  onGoToCaptions?: () => void;
  onGoToPrompts?: () => void;
  onGoToImages?: () => void;
  onGoToThumbnails?: () => void;
  onGoToRender?: () => void;
  onGoToYouTube?: () => void;
  // Callback to heal/update image prompts when count doesn't match images
  onImagePromptsHealed?: (healedPrompts: ImagePromptWithTiming[]) => void;
  // Approval tracking
  approvedSteps?: PipelineStep[];
  onApproveStep?: (step: PipelineStep, approved: boolean) => void;
}

// Parse SRT to get timing info
const parseSRTTimings = (srtContent: string): { startTime: number; endTime: number }[] => {
  const segments: { startTime: number; endTime: number }[] = [];
  const blocks = srtContent.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length >= 2) {
      const timeLine = lines[1];
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
      
      if (timeMatch) {
        const startTime = 
          parseInt(timeMatch[1]) * 3600 + 
          parseInt(timeMatch[2]) * 60 + 
          parseInt(timeMatch[3]) + 
          parseInt(timeMatch[4]) / 1000;
        
        const endTime = 
          parseInt(timeMatch[5]) * 3600 + 
          parseInt(timeMatch[6]) * 60 + 
          parseInt(timeMatch[7]) + 
          parseInt(timeMatch[8]) / 1000;
        
        segments.push({ startTime, endTime });
      }
    }
  }

  return segments;
};

// Format seconds to timestamp string (e.g., "00m00s-00m30s")
const formatTimestamp = (startSec: number, endSec: number): string => {
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
  };
  return `${formatTime(startSec)}-${formatTime(endSec)}`;
};

// Download file from URL - triggers browser's native download with progress
const downloadFromUrl = async (url: string, filename: string) => {
  // For Supabase storage URLs, add download parameter to force download instead of preview
  let downloadUrl = url;
  if (url.includes('supabase.co/storage')) {
    const separator = url.includes('?') ? '&' : '?';
    downloadUrl = `${url}${separator}download=${encodeURIComponent(filename)}`;
  }

  // Create a temporary anchor and click it to trigger native browser download
  // This shows the browser's download progress bar instead of loading into memory first
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Download text content as file
const downloadTextContent = (content: string, filename: string, mimeType: string = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export function ProjectResults({
  sourceUrl,
  onNewProject,
  onBack,
  assets,
  srtContent,
  imagePrompts,
  audioUrl,
  audioDuration,
  projectTitle,
  projectId,
  videoUrl,
  videoUrlCaptioned,
  embersVideoUrl: initialEmbersVideoUrl,
  smokeEmbersVideoUrl: initialSmokeEmbersVideoUrl,
  onVideoRendered,
  onCaptionedVideoRendered,
  onEmbersVideoRendered,
  onSmokeEmbersVideoRendered,
  thumbnails,
  selectedThumbnailIndex,
  script,
  onGoToScript,
  onGoToAudio,
  onGoToCaptions,
  onGoToPrompts,
  onGoToImages,
  onGoToThumbnails,
  onGoToRender,
  onGoToYouTube,
  onImagePromptsHealed,
  approvedSteps = [],
  onApproveStep,
}: ProjectResultsProps) {
  // Helper to toggle step approval
  const toggleApproval = (step: PipelineStep, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onApproveStep) {
      const isCurrentlyApproved = approvedSteps.includes(step);
      onApproveStep(step, !isCurrentlyApproved);
    }
  };

  // State for video rendering - three separate videos (basic, embers, smoke_embers)
  const [isRenderingBasic, setIsRenderingBasic] = useState(false);
  const [isRenderingEmbers, setIsRenderingEmbers] = useState(false);
  const [isRenderingSmokeEmbers, setIsRenderingSmokeEmbers] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderVideoProgress | null>(null);
  const [basicVideoUrl, setBasicVideoUrl] = useState<string | null>(videoUrl || null);
  const [embersVideoUrl, setEmbersVideoUrl] = useState<string | null>(initialEmbersVideoUrl || null);
  const [smokeEmbersVideoUrl, setSmokeEmbersVideoUrl] = useState<string | null>(initialSmokeEmbersVideoUrl || null);
  const [currentRenderType, setCurrentRenderType] = useState<'basic' | 'embers' | 'smoke_embers'>('basic');

  // State for YouTube connection
  const [isYouTubeConnected, setIsYouTubeConnected] = useState(false);
  const [isConnectingYouTube, setIsConnectingYouTube] = useState(false);

  // Sync state with props when they change (handles case where component mounts before state propagates)
  useEffect(() => {
    if (initialEmbersVideoUrl && !embersVideoUrl) {
      setEmbersVideoUrl(initialEmbersVideoUrl);
    }
  }, [initialEmbersVideoUrl]);

  useEffect(() => {
    if (initialSmokeEmbersVideoUrl && !smokeEmbersVideoUrl) {
      setSmokeEmbersVideoUrl(initialSmokeEmbersVideoUrl);
    }
  }, [initialSmokeEmbersVideoUrl]);

  // State for YouTube upload
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);

  // Layout toggle: 'list' (original) or 'grid' (widget style)
  // Set to 'grid' by default for the cute widget layout, change to 'list' to revert
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>('grid');

  // Check YouTube connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const status = await checkYouTubeConnection();
      setIsYouTubeConnected(status.connected);
    };
    checkConnection();
  }, []);

  // Handle YouTube connect
  const handleYouTubeConnect = async () => {
    setIsConnectingYouTube(true);
    try {
      const success = await authenticateYouTube();
      if (success) {
        setIsYouTubeConnected(true);
        toast({
          title: "YouTube Connected",
          description: "Your YouTube account has been connected successfully.",
        });
      }
    } catch (error) {
      console.error('YouTube connect error:', error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect YouTube account.",
        variant: "destructive",
      });
    } finally {
      setIsConnectingYouTube(false);
    }
  };

  // Handle YouTube disconnect
  const handleYouTubeDisconnect = async () => {
    try {
      await disconnectYouTube();
      setIsYouTubeConnected(false);
      toast({
        title: "YouTube Disconnected",
        description: "Your YouTube account has been disconnected.",
      });
    } catch (error) {
      console.error('YouTube disconnect error:', error);
      toast({
        title: "Disconnect Failed",
        description: "Failed to disconnect YouTube account.",
        variant: "destructive",
      });
    }
  };

  // NOTE: Auto-render has been REMOVED from ProjectResults.
  // Full automation mode uses the pipeline modals (review-render, review-youtube) instead.
  // This component is the final "Project Ready" page and should NEVER auto-trigger rendering.

  // Auto-heal image prompts when count doesn't match images
  useEffect(() => {
    const imageAssets = assets.filter(a => a.id.startsWith('image-') && a.url);
    const imageCount = imageAssets.length;
    const promptCount = imagePrompts?.length || 0;

    // Only heal if we have images, srt content, and a mismatch
    if (imageCount > 0 && srtContent && promptCount !== imageCount && onImagePromptsHealed) {
      console.log(`[ProjectResults] Healing image prompts: ${promptCount} prompts → ${imageCount} images`);

      const segments = parseSRTTimings(srtContent);
      if (segments.length === 0) return;

      const totalDuration = segments[segments.length - 1].endTime;
      const imageDuration = totalDuration / imageCount;

      // Create healed prompts with correct timing for each image
      const healedPrompts: ImagePromptWithTiming[] = imageAssets.map((_, index) => {
        const startSeconds = index * imageDuration;
        const endSeconds = (index + 1) * imageDuration;

        // Try to use existing prompt if it exists for this index
        const existingPrompt = imagePrompts?.[index];

        return {
          index,
          prompt: existingPrompt?.prompt || `Scene ${index + 1}`,
          sceneDescription: existingPrompt?.sceneDescription || `Scene ${index + 1}`,
          startSeconds,
          endSeconds,
        };
      });

      onImagePromptsHealed(healedPrompts);
    }
  }, [assets, imagePrompts, srtContent, onImagePromptsHealed]);

  // Calculate image timings based on SRT
  const getImageTimings = () => {
    const imageAssets = assets.filter(a => a.id.startsWith('image-') && a.url);
    if (!srtContent || imageAssets.length === 0) return [];

    const segments = parseSRTTimings(srtContent);
    if (segments.length === 0) return [];

    const totalDuration = segments[segments.length - 1].endTime;
    const imageDuration = totalDuration / imageAssets.length;

    return imageAssets.map((asset, index) => ({
      asset,
      startTime: index * imageDuration,
      endTime: (index + 1) * imageDuration,
    }));
  };

  const imageTimings = getImageTimings();

  const handleDownload = async (asset: GeneratedAsset, customFilename?: string) => {
    try {
      if (asset.content) {
        const extension = asset.type.toLowerCase() === 'markdown' ? 'md' : asset.type.toLowerCase();
        const mimeType = asset.type === 'Markdown' ? 'text/markdown' : 
                         asset.type === 'SRT' ? 'text/plain' : 'text/plain';
        const filename = customFilename || `${asset.name.replace(/\s+/g, '_')}.${extension}`;
        downloadTextContent(asset.content, filename, mimeType);
        toast({
          title: "Download Complete",
          description: `${filename} downloaded successfully.`,
        });
      } else if (asset.url) {
        toast({
          title: "Downloading...",
          description: `Downloading ${asset.name}...`,
        });
        const extension = asset.type.toLowerCase() === 'png' ? 'png' : 
                         asset.type.toLowerCase() === 'markdown' ? 'md' : asset.type.toLowerCase();
        const filename = customFilename || `${asset.name.replace(/\s+/g, '_')}.${extension}`;
        await downloadFromUrl(asset.url, filename);
        toast({
          title: "Download Complete",
          description: `${filename} downloaded successfully.`,
        });
      } else {
        toast({
          title: "Download Unavailable",
          description: "This asset is not available for download yet.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download the file. Please try again.",
        variant: "destructive",
      });
    }
  };


  const handleDownloadAllImagesAsZip = async () => {
    const imageAssets = assets.filter(a => a.id.startsWith('image-') && a.url);
    if (imageAssets.length === 0) {
      toast({
        title: "No Images",
        description: "No images available to download.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Preparing Download",
      description: `Creating zip file with ${imageAssets.length} images...`,
    });

    try {
      const zip = new JSZip();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // Fetch each image via edge function proxy to bypass CORS restrictions
      for (let i = 0; i < imageAssets.length; i++) {
        const asset = imageAssets[i];
        if (!asset.url) continue;

        const timing = imageTimings.find(t => t.asset.id === asset.id);
        const filename = timing
          ? `image_${formatTimestamp(timing.startTime, timing.endTime)}.png`
          : `image_${i + 1}.png`;

        console.log(`Fetching image ${i + 1}/${imageAssets.length}: ${filename}`);

        try {
          // Use edge function as proxy to bypass CORS restrictions
          const response = await fetch(`${supabaseUrl}/functions/v1/download-images-zip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
            body: JSON.stringify({ imageUrl: asset.url })
          });

          if (!response.ok) {
            console.error(`Failed to fetch image ${i + 1}:`, response.status);
            const errorText = await response.text();
            console.error(`Error details:`, errorText);
            continue;
          }

          const blob = await response.blob();
          console.log(`Image ${i + 1} blob size:`, blob.size);

          if (blob.size === 0) {
            console.error(`Image ${i + 1} blob is empty`);
            continue;
          }

          zip.file(filename, blob);
        } catch (error) {
          console.error(`Error fetching image ${i + 1}:`, error);
          continue;
        }
      }

      // Check if any files were added to the ZIP
      const fileCount = Object.keys(zip.files).length;
      console.log(`ZIP contains ${fileCount} files`);

      if (fileCount === 0) {
        toast({
          title: "No Images Downloaded",
          description: "Failed to fetch images. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      console.log(`Generated ZIP blob size: ${zipBlob.size} bytes`);

      if (zipBlob.size === 0) {
        toast({
          title: "ZIP Creation Failed",
          description: "Generated ZIP file is empty. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const url = window.URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'images.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Download Complete",
        description: `images.zip downloaded with ${fileCount} images.`,
      });
    } catch (error) {
      console.error('Zip creation failed:', error);
      toast({
        title: "Download Failed",
        description: "Failed to create zip file. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle Render Video (MP4) - type determines basic, embers, or smoke_embers
  const handleRenderVideo = async (type: 'basic' | 'embers' | 'smoke_embers') => {
    // Validate required data
    if (!projectId) {
      toast({
        title: "Render Unavailable",
        description: "Project ID is required for video rendering.",
        variant: "destructive",
      });
      return;
    }

    if (!audioUrl) {
      toast({
        title: "Render Unavailable",
        description: "Audio is required for video rendering.",
        variant: "destructive",
      });
      return;
    }

    if (!srtContent) {
      toast({
        title: "Render Unavailable",
        description: "Captions are required for video rendering.",
        variant: "destructive",
      });
      return;
    }

    const imageAssets = assets.filter(a => a.id.startsWith('image-') && a.url);
    if (imageAssets.length === 0) {
      toast({
        title: "Render Unavailable",
        description: "Images are required for video rendering.",
        variant: "destructive",
      });
      return;
    }

    // Get image URLs and timings
    const imageUrls = imageAssets.map(a => a.url!);
    let timings: { startSeconds: number; endSeconds: number }[] = [];

    // Only use imagePrompts if they match image count exactly
    if (imagePrompts && imagePrompts.length === imageAssets.length) {
      timings = imagePrompts.map(p => ({
        startSeconds: p.startSeconds,
        endSeconds: p.endSeconds
      }));
    } else {
      // Calculate evenly distributed timings from SRT
      const srtTimings = parseSRTTimings(srtContent);
      const totalDuration = srtTimings.length > 0 ? srtTimings[srtTimings.length - 1].endTime : 0;
      const imageDuration = totalDuration / imageAssets.length;
      timings = imageAssets.map((_, i) => ({
        startSeconds: i * imageDuration,
        endSeconds: (i + 1) * imageDuration
      }));
    }

    // Set effects based on type
    const effects: VideoEffects = {
      embers: type === 'embers',
      smoke_embers: type === 'smoke_embers'
    };

    // Start rendering
    setCurrentRenderType(type);
    if (type === 'basic') {
      setIsRenderingBasic(true);
      setBasicVideoUrl(null);
    } else if (type === 'embers') {
      setIsRenderingEmbers(true);
      setEmbersVideoUrl(null);
    } else {
      setIsRenderingSmokeEmbers(true);
      setSmokeEmbersVideoUrl(null);
    }
    setRenderProgress({ stage: 'downloading', percent: 0, message: 'Starting...' });

    try {
      const result = await renderVideoStreaming(
        projectId,
        audioUrl,
        imageUrls,
        timings,
        srtContent,
        projectTitle || 'HistoryGenAI Export',
        {
          onProgress: (progress) => setRenderProgress(progress),
          onVideoReady: (url) => {
            // Video is ready - show preview immediately
            if (type === 'basic') {
              setBasicVideoUrl(url);
              if (onVideoRendered) onVideoRendered(url);
            } else if (type === 'embers') {
              setEmbersVideoUrl(url);
              if (onEmbersVideoRendered) onEmbersVideoRendered(url);
            } else {
              setSmokeEmbersVideoUrl(url);
              if (onSmokeEmbersVideoRendered) onSmokeEmbersVideoRendered(url);
            }
            toast({
              title: "Video Ready",
              description: type === 'embers' ? "Your video with embers effect has been rendered!" :
                          type === 'smoke_embers' ? "Your video with smoke & embers effect has been rendered!" :
                          "Your video has been rendered successfully!",
            });
          },
          onCaptionError: (error) => {
            // Caption errors are now ignored since we don't burn captions
            console.warn('Caption error (ignored):', error);
          }
        },
        effects
      );

      // Final result
      if (result.success && result.videoUrl) {
        if (type === 'basic') {
          setBasicVideoUrl(result.videoUrl);
          setIsRenderingBasic(false);
          if (onVideoRendered) onVideoRendered(result.videoUrl);
        } else if (type === 'embers') {
          setEmbersVideoUrl(result.videoUrl);
          setIsRenderingEmbers(false);
          if (onEmbersVideoRendered) onEmbersVideoRendered(result.videoUrl);
        } else {
          setSmokeEmbersVideoUrl(result.videoUrl);
          setIsRenderingSmokeEmbers(false);
          if (onSmokeEmbersVideoRendered) onSmokeEmbersVideoRendered(result.videoUrl);
        }
        toast({
          title: "Video Complete",
          description: "Your video is ready to download!",
        });
      } else {
        // Show error
        if (type === 'basic') {
          setIsRenderingBasic(false);
        } else if (type === 'embers') {
          setIsRenderingEmbers(false);
        } else {
          setIsRenderingSmokeEmbers(false);
        }
        toast({
          title: "Render Failed",
          description: result.error || "Failed to render video. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Render video error:', error);
      if (type === 'basic') {
        setIsRenderingBasic(false);
      } else if (type === 'embers') {
        setIsRenderingEmbers(false);
      } else {
        setIsRenderingSmokeEmbers(false);
      }
      toast({
        title: "Render Failed",
        description: error instanceof Error ? error.message : "Failed to render video. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Sanitize project title for filename
  const getSafeFilename = (title: string | undefined, suffix: string = '') => {
    const base = (title || 'video').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50);
    return suffix ? `${base}_${suffix}.mp4` : `${base}.mp4`;
  };

  // Download rendered video
  const handleDownloadVideo = async (type: 'basic' | 'embers' | 'smoke_embers') => {
    const url = type === 'basic' ? basicVideoUrl : (type === 'embers' ? embersVideoUrl : smokeEmbersVideoUrl);
    if (!url) return;

    const suffix = type === 'embers' ? 'embers' : (type === 'smoke_embers' ? 'smoke_embers' : '');
    const filename = getSafeFilename(projectTitle, suffix);
    const description = type === 'smoke_embers' ? 'video with smoke + embers...' : (type === 'embers' ? 'video with embers...' : 'video...');
    toast({
      title: "Downloading...",
      description: `Downloading ${description}`,
    });

    try {
      await downloadFromUrl(url, filename);
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

  // Close render modal
  const handleCloseRenderModal = () => {
    const isRendering = isRenderingBasic || isRenderingEmbers;
    const hasVideo = currentRenderType === 'basic' ? basicVideoUrl : embersVideoUrl;
    if (!isRendering || hasVideo) {
      setIsRenderingBasic(false);
      setIsRenderingEmbers(false);
      setRenderProgress(null);
    }
  };

  // Get stage label for progress
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
    <div className="w-full max-w-xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          {onGoToImages && (
            <Button variant="outline" size="icon" onClick={onGoToImages} title="Back to images">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Project Ready</h1>
            <p className="text-muted-foreground">{projectTitle || "Untitled Project"}</p>
          </div>
        </div>
        {/* Layout toggle button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLayoutMode(prev => prev === 'grid' ? 'list' : 'grid')}
          title={layoutMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
          className="text-muted-foreground"
        >
          {layoutMode === 'grid' ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
        </Button>
      </div>

      {/* Pipeline Steps */}
      <div className="space-y-4">
        {/* GRID LAYOUT (Widget Style) */}
        {layoutMode === 'grid' && (
          <div className="grid grid-cols-3 gap-3">
            {/* Script */}
            {assets.find(a => a.id === 'script') && (
              <PipelineWidget
                emoji="📝"
                label="Script"
                subtitle={assets.find(a => a.id === 'script')!.size}
                isApproved={approvedSteps.includes('script')}
                hasDownload
                onClick={() => onGoToScript?.()}
                onDownload={() => handleDownload(assets.find(a => a.id === 'script')!, 'script.txt')}
                onToggleApproval={(e) => toggleApproval('script', e)}
              />
            )}

            {/* Audio */}
            {assets.find(a => a.id === 'audio') && (
              <PipelineWidget
                emoji="🎙️"
                label="Audio"
                subtitle={assets.find(a => a.id === 'audio')!.size}
                isApproved={approvedSteps.includes('audio')}
                hasDownload
                onClick={() => onGoToAudio?.()}
                onDownload={() => handleDownload(assets.find(a => a.id === 'audio')!, 'voiceover.wav')}
                onToggleApproval={(e) => toggleApproval('audio', e)}
              />
            )}

            {/* Captions */}
            {srtContent && (
              <PipelineWidget
                emoji="💬"
                label="Captions"
                subtitle={`${(srtContent.match(/^\d+$/gm) || []).length} segments`}
                isApproved={approvedSteps.includes('captions')}
                hasDownload
                onClick={() => onGoToCaptions?.()}
                onDownload={() => {
                  const blob = new Blob([srtContent], { type: 'text/plain' });
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'captions.srt';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                }}
                onToggleApproval={(e) => toggleApproval('captions', e)}
              />
            )}

            {/* Image Prompts */}
            {imagePrompts && imagePrompts.length > 0 && (
              <PipelineWidget
                emoji="🎨"
                label="Prompts"
                subtitle={`${imagePrompts.length} scenes`}
                isApproved={approvedSteps.includes('prompts')}
                onClick={() => onGoToPrompts?.()}
                onToggleApproval={(e) => toggleApproval('prompts', e)}
              />
            )}

            {/* Images */}
            {assets.some(a => a.id.startsWith('image-') && a.url) && (
              <PipelineWidget
                emoji="🖼️"
                label="Images"
                subtitle={`${assets.filter(a => a.id.startsWith('image-') && a.url).length} generated`}
                isApproved={approvedSteps.includes('images')}
                hasDownload
                onClick={() => onGoToImages?.()}
                onDownload={handleDownloadAllImagesAsZip}
                onToggleApproval={(e) => toggleApproval('images', e)}
              />
            )}

            {/* Thumbnails */}
            {onGoToThumbnails && (
              <PipelineWidget
                emoji="🎯"
                label="Thumbnails"
                subtitle={thumbnails && thumbnails.length > 0
                  ? selectedThumbnailIndex !== undefined && selectedThumbnailIndex >= 0
                    ? 'Selected'
                    : `${thumbnails.length} ready`
                  : 'Generate'}
                isApproved={approvedSteps.includes('thumbnails')}
                onClick={() => onGoToThumbnails?.()}
                onToggleApproval={(e) => toggleApproval('thumbnails', e)}
              />
            )}

            {/* Video Render */}
            {audioUrl && srtContent && assets.some(a => a.id.startsWith('image-')) && projectId && (() => {
              const videoVersions = [basicVideoUrl, embersVideoUrl, smokeEmbersVideoUrl].filter(Boolean).length;
              const hasVideo = videoVersions > 0;
              return (
                <PipelineWidget
                  emoji="🎬"
                  label="Video"
                  subtitle={hasVideo ? `V${videoVersions} rendered` : 'Render'}
                  isApproved={approvedSteps.includes('render')}
                  hasDownload={!!smokeEmbersVideoUrl}
                  onClick={() => onGoToRender?.()}
                  onDownload={() => handleDownloadVideo('smoke_embers')}
                  onToggleApproval={(e) => toggleApproval('render', e)}
                />
              );
            })()}

            {/* YouTube Upload */}
            {(basicVideoUrl || embersVideoUrl || smokeEmbersVideoUrl || videoUrl || initialEmbersVideoUrl || initialSmokeEmbersVideoUrl) && (
              <PipelineWidget
                emoji="📤"
                label="YouTube"
                subtitle="Upload"
                isApproved={approvedSteps.includes('youtube')}
                onClick={() => setIsYouTubeModalOpen(true)}
                onToggleApproval={(e) => toggleApproval('youtube', e)}
              />
            )}

            {/* YouTube Account */}
            {(() => {
              const hasVideo = basicVideoUrl || embersVideoUrl || smokeEmbersVideoUrl ||
                              videoUrl || initialEmbersVideoUrl || initialSmokeEmbersVideoUrl;
              return (
                <div
                  className={`relative flex flex-col items-center p-4 bg-card rounded-xl border transition-all ${
                    isYouTubeConnected ? 'cursor-pointer hover:scale-[1.02] border-border hover:border-primary/20' : 'border-border'
                  }`}
                  onClick={() => {
                    if (isYouTubeConnected && hasVideo) {
                      setIsYouTubeModalOpen(true);
                    }
                  }}
                >
                  <span className="text-3xl mb-2">🔗</span>
                  <p className="font-medium text-foreground text-sm">Account</p>
                  <p className="text-xs text-muted-foreground mt-0.5 text-center">
                    {isYouTubeConnected ? 'Connected' : 'Not connected'}
                  </p>
                  <div className="mt-3">
                    <Button
                      variant={isYouTubeConnected ? "outline" : "default"}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isYouTubeConnected) {
                          handleYouTubeDisconnect();
                        } else {
                          handleYouTubeConnect();
                        }
                      }}
                      disabled={isConnectingYouTube}
                      className={`h-7 text-xs ${isYouTubeConnected ? "" : "bg-red-600 hover:bg-red-700 text-white"}`}
                    >
                      {isConnectingYouTube ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : isYouTubeConnected ? (
                        'Disconnect'
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* LIST LAYOUT (Original Style) - Easy to revert by changing default layoutMode to 'list' */}
        {layoutMode === 'list' && (
        <div className="space-y-3">
          {/* Script */}
          {assets.find(a => a.id === 'script') && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('script')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToScript}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">📝</span>
                <div>
                  <p className="font-medium text-foreground">Script</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.find(a => a.id === 'script')!.size}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(assets.find(a => a.id === 'script')!, 'script.txt');
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Download"
                >
                  <Download className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => toggleApproval('script', e)}
                  className={`w-10 h-10 rounded-lg ${
                    approvedSteps.includes('script')
                      ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={approvedSteps.includes('script') ? 'Mark as not approved' : 'Mark as approved'}
                >
                  {approvedSteps.includes('script') ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Audio */}
          {assets.find(a => a.id === 'audio') && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('audio')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToAudio}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🎙️</span>
                <div>
                  <p className="font-medium text-foreground">Audio</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.find(a => a.id === 'audio')!.size}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(assets.find(a => a.id === 'audio')!, 'voiceover.wav');
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Download"
                >
                  <Download className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => toggleApproval('audio', e)}
                  className={`w-10 h-10 rounded-lg ${
                    approvedSteps.includes('audio')
                      ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={approvedSteps.includes('audio') ? 'Mark as not approved' : 'Mark as approved'}
                >
                  {approvedSteps.includes('audio') ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Captions */}
          {srtContent && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('captions')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToCaptions}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">💬</span>
                <div>
                  <p className="font-medium text-foreground">Captions</p>
                  <p className="text-sm text-muted-foreground">
                    {(srtContent.match(/^\d+$/gm) || []).length} segments
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    const blob = new Blob([srtContent], { type: 'text/plain' });
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'captions.srt';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(url);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Download"
                >
                  <Download className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => toggleApproval('captions', e)}
                  className={`w-10 h-10 rounded-lg ${
                    approvedSteps.includes('captions')
                      ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={approvedSteps.includes('captions') ? 'Mark as not approved' : 'Mark as approved'}
                >
                  {approvedSteps.includes('captions') ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Image Prompts */}
          {imagePrompts && imagePrompts.length > 0 && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('prompts')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToPrompts}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🎨</span>
                <div>
                  <p className="font-medium text-foreground">Image Prompts</p>
                  <p className="text-sm text-muted-foreground">
                    {imagePrompts.length} scene descriptions
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => toggleApproval('prompts', e)}
                className={`w-10 h-10 rounded-lg ${
                  approvedSteps.includes('prompts')
                    ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={approvedSteps.includes('prompts') ? 'Mark as not approved' : 'Mark as approved'}
              >
                {approvedSteps.includes('prompts') ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </Button>
            </div>
          )}

          {/* Images */}
          {assets.some(a => a.id.startsWith('image-') && a.url) && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('images')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToImages}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🖼️</span>
                <div>
                  <p className="font-medium text-foreground">Images</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.filter(a => a.id.startsWith('image-') && a.url).length} generated
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadAllImagesAsZip();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Download ZIP"
                >
                  <Download className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => toggleApproval('images', e)}
                  className={`w-10 h-10 rounded-lg ${
                    approvedSteps.includes('images')
                      ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={approvedSteps.includes('images') ? 'Mark as not approved' : 'Mark as approved'}
                >
                  {approvedSteps.includes('images') ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Thumbnails */}
          {onGoToThumbnails && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('thumbnails')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-primary/20'
              }`}
              onClick={onGoToThumbnails}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🎯</span>
                <div>
                  <p className="font-medium text-foreground">Thumbnails</p>
                  <p className="text-sm text-muted-foreground">
                    {thumbnails && thumbnails.length > 0
                      ? selectedThumbnailIndex !== undefined && selectedThumbnailIndex >= 0
                        ? 'Thumbnail selected'
                        : `${thumbnails.length} generated`
                      : 'Generate thumbnails'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => toggleApproval('thumbnails', e)}
                className={`w-10 h-10 rounded-lg ${
                  approvedSteps.includes('thumbnails')
                    ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={approvedSteps.includes('thumbnails') ? 'Mark as not approved' : 'Mark as approved'}
              >
                {approvedSteps.includes('thumbnails') ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </Button>
            </div>
          )}

          {/* Video Render */}
          {audioUrl && srtContent && assets.some(a => a.id.startsWith('image-')) && projectId && (() => {
            // Count video versions
            const videoVersions = [basicVideoUrl, embersVideoUrl, smokeEmbersVideoUrl].filter(Boolean).length;
            const hasVideo = videoVersions > 0;

            return (
              <div
                className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                  approvedSteps.includes('render')
                    ? 'border-green-500/50 hover:border-green-500'
                    : 'border-border hover:border-primary/20'
                }`}
                onClick={onGoToRender}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">🎬</span>
                  <div>
                    <p className="font-medium text-foreground">Video Render</p>
                    <p className="text-sm text-muted-foreground">
                      {hasVideo
                        ? `V${videoVersions} rendered${smokeEmbersVideoUrl ? ' (smoke + embers)' : embersVideoUrl ? ' (embers)' : ''}`
                        : 'Render video with effects'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {smokeEmbersVideoUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadVideo('smoke_embers');
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      title="Download Video"
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => toggleApproval('render', e)}
                    className={`w-10 h-10 rounded-lg ${
                      approvedSteps.includes('render')
                        ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                    title={approvedSteps.includes('render') ? 'Mark as not approved' : 'Mark as approved'}
                  >
                    {approvedSteps.includes('render') ? (
                      <CheckSquare className="w-5 h-5" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* YouTube Upload */}
          {(basicVideoUrl || embersVideoUrl || smokeEmbersVideoUrl || videoUrl || initialEmbersVideoUrl || initialSmokeEmbersVideoUrl) && (
            <div
              className={`flex items-center justify-between p-4 bg-card rounded-xl border transition-colors cursor-pointer ${
                approvedSteps.includes('youtube')
                  ? 'border-green-500/50 hover:border-green-500'
                  : 'border-border hover:border-red-500/20'
              }`}
              onClick={() => setIsYouTubeModalOpen(true)}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">📤</span>
                <div>
                  <p className="font-medium text-foreground">YouTube Upload</p>
                  <p className="text-sm text-muted-foreground">
                    Schedule or upload as draft
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => toggleApproval('youtube', e)}
                className={`w-10 h-10 rounded-lg ${
                  approvedSteps.includes('youtube')
                    ? 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={approvedSteps.includes('youtube') ? 'Mark as not approved' : 'Mark as approved'}
              >
                {approvedSteps.includes('youtube') ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </Button>
            </div>
          )}

          {/* YouTube Account Connect */}
          {(() => {
            // Check both state and props for video URL availability
            const hasVideo = basicVideoUrl || embersVideoUrl || smokeEmbersVideoUrl ||
                            videoUrl || initialEmbersVideoUrl || initialSmokeEmbersVideoUrl;
            return (
              <div
                className={`flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-red-500/20 transition-colors ${isYouTubeConnected ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  // If connected, open upload modal (modal will show message if no video)
                  if (isYouTubeConnected) {
                    if (hasVideo) {
                      setIsYouTubeModalOpen(true);
                    } else {
                      toast({
                        title: "No Video Available",
                        description: "Please render a video first before uploading to YouTube.",
                        variant: "destructive",
                      });
                    }
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">🔗</span>
                  <div>
                    <p className="font-medium text-foreground">YouTube Account</p>
                    <p className="text-sm text-muted-foreground">
                      {isYouTubeConnected
                        ? hasVideo
                          ? 'Connected - Click to upload'
                          : 'Connected - Render video first'
                        : 'Not connected'}
                    </p>
                  </div>
                </div>
                <Button
                  variant={isYouTubeConnected ? "outline" : "default"}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isYouTubeConnected) {
                      handleYouTubeDisconnect();
                    } else {
                      handleYouTubeConnect();
                    }
                  }}
                  disabled={isConnectingYouTube}
                  className={isYouTubeConnected ? "" : "bg-red-600 hover:bg-red-700 text-white"}
                >
                  {isConnectingYouTube ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : isYouTubeConnected ? (
                    'Disconnect'
                  ) : (
                    'Connect'
                  )}
                </Button>
              </div>
            );
          })()}
        </div>
        )}

        {assets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No assets generated yet.</p>
          </div>
        )}
      </div>

      {/* Render Progress Modal */}
      <Dialog open={isRenderingBasic || isRenderingEmbers || isRenderingSmokeEmbers} onOpenChange={handleCloseRenderModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {currentRenderType !== 'basic' ? <Sparkles className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              {(currentRenderType === 'basic' ? basicVideoUrl : (currentRenderType === 'embers' ? embersVideoUrl : smokeEmbersVideoUrl))
                ? 'Video Ready'
                : `Rendering ${currentRenderType === 'smoke_embers' ? 'with Smoke + Embers' : currentRenderType === 'embers' ? 'with Embers' : 'Video'}`}
            </DialogTitle>
            <DialogDescription>
              {(currentRenderType === 'basic' ? basicVideoUrl : (currentRenderType === 'embers' ? embersVideoUrl : smokeEmbersVideoUrl))
                ? 'Your video has been rendered successfully.'
                : 'Please wait while your video is being rendered.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Video Preview Player */}
            {(currentRenderType === 'basic' ? basicVideoUrl : (currentRenderType === 'embers' ? embersVideoUrl : smokeEmbersVideoUrl)) && (
              <div className="space-y-3">
                <video
                  src={currentRenderType === 'basic' ? basicVideoUrl! : (currentRenderType === 'embers' ? embersVideoUrl! : smokeEmbersVideoUrl!)}
                  controls
                  preload="auto"
                  crossOrigin="anonymous"
                  className="w-full rounded-lg border"
                  style={{ maxHeight: '300px' }}
                />

                <Button onClick={() => handleDownloadVideo(currentRenderType)} className="w-full gap-2">
                  <Download className="w-4 h-4" />
                  Download Video
                </Button>
              </div>
            )}

            {/* Initial rendering progress (before video is ready) */}
            {!(currentRenderType === 'basic' ? basicVideoUrl : (currentRenderType === 'embers' ? embersVideoUrl : smokeEmbersVideoUrl)) && renderProgress && (
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
          </div>
        </DialogContent>
      </Dialog>

      {/* YouTube Upload Modal */}
      <YouTubeUploadModal
        isOpen={isYouTubeModalOpen}
        videoUrl={embersVideoUrl || smokeEmbersVideoUrl || basicVideoUrl || initialSmokeEmbersVideoUrl || initialEmbersVideoUrl || videoUrl || ''}
        projectTitle={projectTitle}
        script={script}
        thumbnails={thumbnails}
        selectedThumbnailIndex={selectedThumbnailIndex}
        onClose={() => setIsYouTubeModalOpen(false)}
        onSuccess={(youtubeUrl) => {
          console.log('Video uploaded to YouTube:', youtubeUrl);
          setIsYouTubeModalOpen(false);
        }}
      />
    </div>
  );
}
