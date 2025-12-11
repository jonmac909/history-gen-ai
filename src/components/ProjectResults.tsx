import { FileText, Mic, Subtitles, Download, Play, RefreshCw, Layers, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { downloadFile, downloadText } from "@/lib/api";

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
}

export function ProjectResults({ sourceUrl, onNewProject, assets, audioUrl }: ProjectResultsProps) {
  const handleDownload = (asset: GeneratedAsset) => {
    if (asset.url) {
      downloadFile(asset.url, `${asset.id}.${asset.type.toLowerCase()}`);
      toast({
        title: "Download Started",
        description: `Downloading ${asset.name}...`,
      });
    } else if (asset.content) {
      const extension = asset.type.toLowerCase() === 'markdown' ? 'md' : asset.type.toLowerCase();
      downloadText(asset.content, `${asset.id}.${extension}`, 
        asset.type === 'Markdown' ? 'text/markdown' : 'text/plain');
      toast({
        title: "Download Started",
        description: `Downloading ${asset.name}...`,
      });
    } else {
      toast({
        title: "Download Unavailable",
        description: "This asset is not available for download yet.",
        variant: "destructive",
      });
    }
  };

  const handlePlayAudio = () => {
    if (audioUrl) {
      window.open(audioUrl, '_blank');
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
        {/* Video/Audio Preview */}
        <div className="space-y-4">
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
            {/* Audio player placeholder with play button */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              {audioUrl ? (
                <>
                  <button 
                    onClick={handlePlayAudio}
                    className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                  >
                    <Play className="w-8 h-8 text-white ml-1" fill="white" />
                  </button>
                  <audio controls className="w-full max-w-md px-4">
                    <source src={audioUrl} type="audio/mpeg" />
                    Your browser does not support the audio element.
                  </audio>
                </>
              ) : (
                <div className="text-white/60 text-center">
                  <Play className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No audio preview available</p>
                </div>
              )}
            </div>
            
            {/* Source URL bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80">
              <p className="text-white text-sm truncate">{sourceUrl}</p>
            </div>
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
