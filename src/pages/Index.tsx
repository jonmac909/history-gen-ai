import { useState } from "react";
import { Youtube, Settings, Sparkles, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

const statusIndicators = [
  { name: "Google Ready", status: true },
  { name: "Claude Ready", status: true },
  { name: "Cartesia Ready", status: true },
  { name: "Kie Ready", status: true },
];

const Index = () => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async () => {
    if (!url.trim()) {
      toast({
        title: "URL Required",
        description: "Please paste a YouTube URL to generate.",
        variant: "destructive",
      });
      return;
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    if (!youtubeRegex.test(url)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid YouTube URL.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    toast({
      title: "Generation Started",
      description: "Your history video assets are being created.",
    });
    
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-amber-700" />
            </div>
            <span className="text-lg font-semibold text-foreground">
              HistoryGen AI
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center px-4 py-32">
        <div className="w-full max-w-3xl mx-auto text-center space-y-8">
          {/* Title */}
          <div className="space-y-3">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight">
              Create History AI Video
            </h1>
            <p className="text-lg text-muted-foreground">
              From YouTube URL to full production ready assets in minutes.
            </p>
          </div>

          {/* URL Input */}
          <div className="bg-card rounded-2xl shadow-sm border border-border p-2 flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-xl">
              <Youtube className="w-5 h-5 text-red-500" />
              <span className="text-sm font-medium text-muted-foreground">URL</span>
            </div>
            
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube URL..."
              className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base placeholder:text-muted-foreground/60"
            />
            
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Settings className="w-5 h-5" />
            </Button>
            
            <Button
              onClick={handleGenerate}
              disabled={isLoading}
              className="shrink-0 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground rounded-xl px-5"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {isLoading ? "Generating..." : "Generate"}
            </Button>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center justify-center gap-6 flex-wrap">
            {statusIndicators.map((indicator) => (
              <div key={indicator.name} className="flex items-center gap-2">
                <div className="status-dot" />
                <span className="text-sm text-muted-foreground">
                  {indicator.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;