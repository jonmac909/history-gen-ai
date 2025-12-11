import { FileText, Mic, Video, Subtitles, Download, Play, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GeneratedAsset {
  id: string;
  name: string;
  type: string;
  size: string;
  icon: React.ReactNode;
}

interface ProjectResultsProps {
  sourceUrl: string;
  onNewProject: () => void;
}

const generatedAssets: GeneratedAsset[] = [
  {
    id: "script",
    name: "Rewritten Script (Claude)",
    type: "Markdown",
    size: "12 KB",
    icon: <FileText className="w-5 h-5 text-muted-foreground" />,
  },
  {
    id: "audio",
    name: "Voiceover Audio (Cartesia)",
    type: "WAV",
    size: "4.2 MB",
    icon: <Mic className="w-5 h-5 text-muted-foreground" />,
  },
  {
    id: "video",
    name: "Scene Video Clips (Kie.ai)",
    type: "MP4 Archive",
    size: "145 MB",
    icon: <Video className="w-5 h-5 text-muted-foreground" />,
  },
  {
    id: "captions",
    name: "Captions",
    type: "SRT",
    size: "4 KB",
    icon: <Subtitles className="w-5 h-5 text-muted-foreground" />,
  },
];

export function ProjectResults({ sourceUrl, onNewProject }: ProjectResultsProps) {
  const handleDownload = (assetId: string) => {
    // In production, this would trigger actual file download
    console.log("Downloading asset:", assetId);
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
        {/* Video Preview */}
        <div className="space-y-4">
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
            {/* Video placeholder with play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <button className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </button>
            </div>
            
            {/* Video progress bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <p className="text-white text-sm mb-2 truncate">{sourceUrl}</p>
              <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-primary rounded-full" />
              </div>
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
            {generatedAssets.map((asset) => (
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDownload(asset.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-5 h-5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}