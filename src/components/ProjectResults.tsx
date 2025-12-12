import { useState } from "react";
import { Download, RefreshCw, Layers, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

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
  assets: GeneratedAsset[];
  audioUrl?: string;
  srtContent?: string;
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

export function ProjectResults({ sourceUrl, onNewProject, assets, audioUrl, srtContent }: ProjectResultsProps) {
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

  const handleDownloadImage = (asset: GeneratedAsset) => {
    // Find timing for this image
    const timing = imageTimings.find(t => t.asset.id === asset.id);
    if (timing) {
      const timestamp = formatTimestamp(timing.startTime, timing.endTime);
      const filename = `image_${timestamp}.png`;
      handleDownload(asset, filename);
    } else {
      handleDownload(asset);
    }
  };

  const handleDownloadAllImages = () => {
    imageTimings.forEach((timing, i) => {
      setTimeout(() => {
        const timestamp = formatTimestamp(timing.startTime, timing.endTime);
        const filename = `image_${timestamp}.png`;
        handleDownload(timing.asset, filename);
      }, i * 500);
    });
    toast({
      title: "Downloading All Images",
      description: `Downloading ${imageTimings.length} images with timestamps...`,
    });
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Project Ready</h1>
          <p className="text-muted-foreground">{sourceUrl}</p>
        </div>
        <Button variant="outline" onClick={onNewProject} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Preview Area */}
        <div className="space-y-4">
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center">
            {audioUrl ? (
              <audio controls className="w-full max-w-md px-8">
                <source src={audioUrl} type="audio/mpeg" />
                Your browser does not support the audio element.
              </audio>
            ) : (
              <div className="text-white/60 text-center">
                <p>No preview available</p>
              </div>
            )}
          </div>

          {/* Image Timings Info */}
          {imageTimings.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold text-foreground">Image Timings</h3>
                </div>
                <Button onClick={handleDownloadAllImages} className="gap-2">
                  <Download className="w-4 h-4" />
                  Download All ({imageTimings.length})
                </Button>
              </div>

              <div className="space-y-2">
                {imageTimings.map((timing, index) => (
                  <div key={timing.asset.id} className="flex items-center justify-between p-2 bg-secondary/50 rounded-lg">
                    <span className="text-sm text-foreground">
                      Image {index + 1}: {formatTimestamp(timing.startTime, timing.endTime)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => handleDownloadImage(timing.asset)}>
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Generated Assets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Generated Assets</h2>
          </div>

          <div className="space-y-3">
            {assets.map((asset) => {
              const isImage = asset.id.startsWith('image-');
              const timing = isImage ? imageTimings.find(t => t.asset.id === asset.id) : null;
              const displayName = timing 
                ? `Image ${formatTimestamp(timing.startTime, timing.endTime)}`
                : asset.name;

              return (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                      {asset.icon}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        {asset.type} • {asset.size}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {asset.url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(asset.url, '_blank')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => isImage ? handleDownloadImage(asset) : handleDownload(asset)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Download"
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {assets.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No assets generated yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
