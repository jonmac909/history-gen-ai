import { useState, useEffect, useRef } from "react";
import { Download, RefreshCw, Layers, Image, ChevronLeft, Film, Video, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { generateFCPXML, parseSRTToCaptions, type FCPXMLImage } from "@/lib/fcpxmlGenerator";
import { renderVideoStreaming, type ImagePromptWithTiming, type RenderVideoProgress } from "@/lib/api";

export interface GeneratedAsset {
  id: string;
  name: string;
  type: string;
  size: string;
  icon: React.ReactNode;
  url?: string;
  content?: string;
}

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
  videoUrl?: string;  // Pre-rendered video URL (from saved project)
  onVideoRendered?: (videoUrl: string) => void;  // Callback when video is rendered
  autoRender?: boolean;  // Auto-start video rendering (for full automation mode)
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

// Download file from URL
const downloadFromUrl = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
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
  onVideoRendered,
  autoRender
}: ProjectResultsProps) {
  // State for video rendering - initialize from prop if available
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderVideoProgress | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(videoUrl || null);
  const [captionedVideoUrl, setCaptionedVideoUrl] = useState<string | null>(null);
  const [isBurningCaptions, setIsBurningCaptions] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const autoRenderTriggered = useRef(false);

  // Auto-render video when in full automation mode
  useEffect(() => {
    if (autoRender && !autoRenderTriggered.current && !renderedVideoUrl && !isRendering) {
      // Check if we have all required data for rendering
      const imageAssets = assets.filter(a => a.id.startsWith('image-') && a.url);
      if (projectId && audioUrl && srtContent && imageAssets.length > 0) {
        console.log("[Full Automation] Auto-starting video render...");
        autoRenderTriggered.current = true;
        // Small delay to let the UI render first
        setTimeout(() => {
          handleRenderVideo();
        }, 1000);
      }
    }
  }, [autoRender, projectId, audioUrl, srtContent, assets, renderedVideoUrl, isRendering]);

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

  // Handle FCPXML timeline export
  const handleDownloadFCPXML = () => {
    if (!srtContent) {
      toast({
        title: "Export Unavailable",
        description: "Captions are required for timeline export.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Get image timings from imagePrompts or calculate from SRT
      let images: FCPXMLImage[] = [];

      if (imagePrompts && imagePrompts.length > 0) {
        // Use imagePrompts with proper timing
        images = imagePrompts.map((prompt, index) => ({
          index: index + 1,
          startSeconds: prompt.startSeconds,
          endSeconds: prompt.endSeconds,
        }));
      } else {
        // Fall back to calculated timings
        const timings = getImageTimings();
        images = timings.map((t, index) => ({
          index: index + 1,
          startSeconds: t.startTime,
          endSeconds: t.endTime,
        }));
      }

      // Parse captions from SRT
      const captions = parseSRTToCaptions(srtContent);

      // Calculate total duration
      const srtTimings = parseSRTTimings(srtContent);
      const totalDuration = audioDuration ||
        (srtTimings.length > 0 ? srtTimings[srtTimings.length - 1].endTime : 0);

      // Generate FCPXML
      const fcpxmlContent = generateFCPXML({
        projectTitle: projectTitle || 'HistoryGenAI Export',
        audioDuration: totalDuration,
        images,
        captions,
      });

      // Download the file
      downloadTextContent(fcpxmlContent, 'timeline.fcpxml', 'application/xml');

      toast({
        title: "Timeline Exported",
        description: "FCPXML file downloaded. Import into DaVinci Resolve and link media files.",
      });
    } catch (error) {
      console.error('FCPXML export failed:', error);
      toast({
        title: "Export Failed",
        description: "Failed to generate FCPXML file. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle Render Video (MP4)
  const handleRenderVideo = async () => {
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

    if (imagePrompts && imagePrompts.length > 0) {
      timings = imagePrompts.map(p => ({
        startSeconds: p.startSeconds,
        endSeconds: p.endSeconds
      }));
    } else {
      // Calculate from SRT timings
      const srtTimings = parseSRTTimings(srtContent);
      const totalDuration = srtTimings.length > 0 ? srtTimings[srtTimings.length - 1].endTime : 0;
      const imageDuration = totalDuration / imageAssets.length;
      timings = imageAssets.map((_, i) => ({
        startSeconds: i * imageDuration,
        endSeconds: (i + 1) * imageDuration
      }));
    }

    // Start rendering
    setIsRendering(true);
    setRenderProgress({ stage: 'downloading', percent: 0, message: 'Starting...' });
    setRenderedVideoUrl(null);
    setCaptionedVideoUrl(null);
    setIsBurningCaptions(false);
    setCaptionError(null);

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
            // Video without captions is ready - show preview immediately
            setRenderedVideoUrl(url);
            setIsBurningCaptions(true);
            // Notify parent to save the video URL
            if (onVideoRendered) {
              onVideoRendered(url);
            }
            toast({
              title: "Video Ready",
              description: "Video without captions is ready! Burning captions...",
            });
          },
          onCaptionError: (error) => {
            setIsBurningCaptions(false);
            setCaptionError(error);
            toast({
              title: "Caption Burning Failed",
              description: "Video without captions is still available for download.",
              variant: "destructive",
            });
          }
        }
      );

      // Final result
      setIsBurningCaptions(false);
      if (result.success && result.videoUrl) {
        setRenderedVideoUrl(result.videoUrl);
        if (result.videoUrlCaptioned) {
          setCaptionedVideoUrl(result.videoUrlCaptioned);
          toast({
            title: "Captions Complete",
            description: "Both video versions are ready to download!",
          });
        }
      } else if (!renderedVideoUrl) {
        // Only show error if we don't have any video
        setIsRendering(false);
        toast({
          title: "Render Failed",
          description: result.error || "Failed to render video. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Render video error:', error);
      setIsBurningCaptions(false);
      if (!renderedVideoUrl) {
        setIsRendering(false);
        toast({
          title: "Render Failed",
          description: error instanceof Error ? error.message : "Failed to render video. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Sanitize project title for filename
  const getSafeFilename = (title: string | undefined, suffix: string = '') => {
    const base = (title || 'video').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50);
    return suffix ? `${base}_${suffix}.mp4` : `${base}.mp4`;
  };

  // Download rendered video (without captions)
  const handleDownloadVideo = async () => {
    if (!renderedVideoUrl) return;

    const filename = getSafeFilename(projectTitle);
    toast({
      title: "Downloading...",
      description: "Downloading video without captions...",
    });

    try {
      await downloadFromUrl(renderedVideoUrl, filename);
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

  // Download captioned video
  const handleDownloadCaptionedVideo = async () => {
    if (!captionedVideoUrl) return;

    const filename = getSafeFilename(projectTitle, 'captioned');
    toast({
      title: "Downloading...",
      description: "Downloading video with captions...",
    });

    try {
      await downloadFromUrl(captionedVideoUrl, filename);
      toast({
        title: "Download Complete",
        description: `${filename} downloaded successfully.`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download captioned video. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Close render modal
  const handleCloseRenderModal = () => {
    if (!isRendering || renderedVideoUrl) {
      setIsRendering(false);
      setRenderProgress(null);
      // Don't clear renderedVideoUrl so user can still download
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
          {onBack && (
            <Button variant="outline" size="icon" onClick={onBack} title="Back to previous step">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Project Ready</h1>
            <p className="text-muted-foreground">{sourceUrl}</p>
          </div>
        </div>
        <Button variant="outline" onClick={onNewProject} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {/* Downloads */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Downloads</h2>
        </div>

        <div className="space-y-3">
          {/* Script */}
          {assets.find(a => a.id === 'script') && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  {assets.find(a => a.id === 'script')!.icon}
                </div>
                <div>
                  <p className="font-medium text-foreground">Script</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.find(a => a.id === 'script')!.size}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDownload(assets.find(a => a.id === 'script')!, 'script.txt')}
                className="text-muted-foreground hover:text-foreground"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Audio */}
          {assets.find(a => a.id === 'audio') && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  {assets.find(a => a.id === 'audio')!.icon}
                </div>
                <div>
                  <p className="font-medium text-foreground">Audio</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.find(a => a.id === 'audio')!.size}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDownload(assets.find(a => a.id === 'audio')!, 'voiceover.wav')}
                className="text-muted-foreground hover:text-foreground"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Captions */}
          {assets.find(a => a.id === 'captions') && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  {assets.find(a => a.id === 'captions')!.icon}
                </div>
                <div>
                  <p className="font-medium text-foreground">Captions</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.find(a => a.id === 'captions')!.size}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDownload(assets.find(a => a.id === 'captions')!, 'captions.srt')}
                className="text-muted-foreground hover:text-foreground"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Images */}
          {assets.some(a => a.id.startsWith('image-') && a.url) && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Image className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Images</p>
                  <p className="text-sm text-muted-foreground">
                    {assets.filter(a => a.id.startsWith('image-') && a.url).length} images (ZIP)
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownloadAllImagesAsZip}
                className="text-muted-foreground hover:text-foreground"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Timeline Export (FCPXML) */}
          {srtContent && assets.some(a => a.id.startsWith('image-')) && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Film className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Timeline Export</p>
                  <p className="text-sm text-muted-foreground">
                    FCPXML (DaVinci Resolve, FCP, Premiere)
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownloadFCPXML}
                className="text-muted-foreground hover:text-foreground"
                title="Download FCPXML"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Render Video (MP4 without captions) */}
          {audioUrl && srtContent && assets.some(a => a.id.startsWith('image-')) && projectId && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Video className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {renderedVideoUrl ? 'Video (No Captions)' : 'Render Video'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {renderedVideoUrl ? 'MP4 without captions' : 'MP4 with burned-in captions'}
                  </p>
                </div>
              </div>
              {renderedVideoUrl ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDownloadVideo}
                  className="text-muted-foreground hover:text-foreground"
                  title="Download Video (No Captions)"
                >
                  <Download className="w-5 h-5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRenderVideo}
                  disabled={isRendering}
                  className="text-muted-foreground hover:text-foreground"
                  title="Render Video"
                >
                  {isRendering ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Render"
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Video with Captions (MP4) */}
          {captionedVideoUrl && (
            <div
              className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Video className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Video (With Captions)</p>
                  <p className="text-sm text-muted-foreground">
                    MP4 with burned-in captions
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownloadCaptionedVideo}
                className="text-muted-foreground hover:text-foreground"
                title="Download Video (With Captions)"
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>

        {assets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No assets generated yet.</p>
          </div>
        )}
      </div>

      {/* Render Progress Modal */}
      <Dialog open={isRendering} onOpenChange={handleCloseRenderModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-5 h-5" />
              {renderedVideoUrl ? 'Video Ready' : 'Rendering Video'}
            </DialogTitle>
            <DialogDescription>
              {renderedVideoUrl ? 'Your video has been rendered successfully.' : 'Please wait while your video is being rendered.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Video Preview Player */}
            {renderedVideoUrl && (
              <div className="space-y-3">
                <video
                  src={renderedVideoUrl}
                  controls
                  className="w-full rounded-lg border"
                  style={{ maxHeight: '300px' }}
                />

                <Button onClick={handleDownloadVideo} variant="outline" className="w-full gap-2">
                  <Download className="w-4 h-4" />
                  Download Video (No Captions)
                </Button>

                {/* Caption burning progress */}
                {isBurningCaptions && renderProgress && (
                  <div className="p-3 bg-muted rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Burning captions...</span>
                      <span className="font-medium">{renderProgress.percent}%</span>
                    </div>
                    <Progress value={renderProgress.percent} className="h-2" />
                    <p className="text-xs text-muted-foreground">{renderProgress.message}</p>
                  </div>
                )}

                {/* Captioned video download */}
                {captionedVideoUrl && (
                  <Button onClick={handleDownloadCaptionedVideo} className="w-full gap-2">
                    <Download className="w-4 h-4" />
                    Download Video (With Captions)
                  </Button>
                )}

                {/* Caption error message */}
                {captionError && !captionedVideoUrl && (
                  <p className="text-sm text-destructive text-center">
                    Caption burning failed: {captionError}
                  </p>
                )}
              </div>
            )}

            {/* Initial rendering progress (before video is ready) */}
            {!renderedVideoUrl && renderProgress && (
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
    </div>
  );
}
