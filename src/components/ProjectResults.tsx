import { useState, useEffect, useRef } from "react";
import { Download, RefreshCw, Layers, ExternalLink, Video, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";

export interface GeneratedAsset {
  id: string;
  name: string;
  type: string;
  size: string;
  icon: React.ReactNode;
  url?: string;
  content?: string;
}

interface VideoClip {
  index: number;
  videoUrl: string;
  videoBlob: Blob;
  duration: number;
}

interface ProjectResultsProps {
  sourceUrl: string;
  onNewProject: () => void;
  assets: GeneratedAsset[];
  audioUrl?: string;
  srtContent?: string;
}

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
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const { generateVideo, isGenerating, progress, status } = useVideoGeneration();
  const hasStartedGeneration = useRef(false);

  // Extract image URLs from assets
  const imageUrls = assets
    .filter(a => a.id.startsWith('image-') && a.url)
    .map(a => a.url!);

  // Auto-generate video clips when component mounts with required data
  useEffect(() => {
    if (hasStartedGeneration.current) return;
    if (imageUrls.length === 0 || !srtContent || isGenerating) return;

    hasStartedGeneration.current = true;
    
    const autoGenerate = async () => {
      const result = await generateVideo(imageUrls, srtContent, audioUrl);
      if (result.success && result.clips) {
        setVideoClips(result.clips);
      }
    };
    
    autoGenerate();
  }, [imageUrls.length, srtContent, audioUrl]);

  const handleGenerateVideo = async () => {
    if (imageUrls.length === 0) {
      toast({
        title: "No Images",
        description: "No images available to generate video.",
        variant: "destructive",
      });
      return;
    }

    if (!srtContent) {
      toast({
        title: "No Captions",
        description: "SRT captions are required to generate video with proper timing.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Generating Video Clips",
      description: `Creating ${imageUrls.length} video clips...`,
    });

    const result = await generateVideo(imageUrls, srtContent, audioUrl);

    if (result.success && result.clips) {
      setVideoClips(result.clips);
      toast({
        title: "Video Clips Ready!",
        description: `Generated ${result.clips.length} MP4 clips.`,
      });
    } else {
      toast({
        title: "Video Generation Failed",
        description: result.error || "Failed to generate video",
        variant: "destructive",
      });
    }
  };

  const handleDownloadClip = (clip: VideoClip) => {
    const link = document.createElement('a');
    link.href = clip.videoUrl;
    link.download = `clip_${clip.index + 1}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAllClips = () => {
    videoClips.forEach((clip, i) => {
      setTimeout(() => handleDownloadClip(clip), i * 500);
    });
    toast({
      title: "Downloading All Clips",
      description: `Downloading ${videoClips.length} video clips...`,
    });
  };

  const handleDownload = async (asset: GeneratedAsset) => {
    try {
      if (asset.content) {
        // If we have content, download it directly as text
        const extension = asset.type.toLowerCase() === 'markdown' ? 'md' : asset.type.toLowerCase();
        const mimeType = asset.type === 'Markdown' ? 'text/markdown' : 
                         asset.type === 'SRT' ? 'text/plain' : 'text/plain';
        downloadTextContent(asset.content, `${asset.name.replace(/\s+/g, '_')}.${extension}`, mimeType);
        toast({
          title: "Download Complete",
          description: `${asset.name} downloaded successfully.`,
        });
      } else if (asset.url) {
        // Download from URL
        toast({
          title: "Downloading...",
          description: `Downloading ${asset.name}...`,
        });
        const extension = asset.type.toLowerCase() === 'markdown' ? 'md' : asset.type.toLowerCase();
        await downloadFromUrl(asset.url, `${asset.name.replace(/\s+/g, '_')}.${extension}`);
        toast({
          title: "Download Complete",
          description: `${asset.name} downloaded successfully.`,
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
            {videoClips.length > 0 ? (
              <video controls className="w-full h-full">
                <source src={videoClips[0].videoUrl} type="video/mp4" />
                Your browser does not support the video element.
              </video>
            ) : audioUrl ? (
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

          {/* Video Generation Section */}
          <div className="bg-card rounded-xl border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-foreground">MP4 Video Clips</h3>
              </div>
              {videoClips.length > 0 && (
                <Button onClick={handleDownloadAllClips} className="gap-2">
                  <Download className="w-4 h-4" />
                  Download All ({videoClips.length})
                </Button>
              )}
            </div>

            {isGenerating && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{status}</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Video Clips List */}
            {videoClips.length > 0 && (
              <div className="space-y-2">
                {videoClips.map((clip) => (
                  <div key={clip.index} className="flex items-center justify-between p-2 bg-secondary/50 rounded-lg">
                    <span className="text-sm text-foreground">
                      Clip {clip.index + 1} ({clip.duration.toFixed(1)}s)
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => handleDownloadClip(clip)}>
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {videoClips.length === 0 && !isGenerating && (
              <p className="text-sm text-muted-foreground">
                Generating video clips automatically...
              </p>
            )}
          </div>
        </div>

        {/* Generated Assets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Generated Assets</h2>
          </div>

          <div className="space-y-3">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    {asset.icon}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{asset.name}</p>
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
                    onClick={() => handleDownload(asset)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Download"
                  >
                    <Download className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            ))}
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
