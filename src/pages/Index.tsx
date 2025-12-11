import { useState, useEffect } from "react";
import { Youtube, FileText, Settings, Sparkles, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { SettingsPopover, type GenerationSettings } from "@/components/SettingsPopover";
import { ProcessingModal, type GenerationStep } from "@/components/ProcessingModal";
import { StatusIndicator } from "@/components/StatusIndicator";

type InputMode = "url" | "title";

// Simulated API key status - in production, check against actual secrets
const useApiKeyStatus = () => {
  const [status, setStatus] = useState({
    google: false,
    claude: false,
    cartesia: false,
    kie: false,
  });

  // In a real app, this would check if API keys are configured
  // For now, all are false until connected to backend
  useEffect(() => {
    // This would be replaced with actual API key verification
    setStatus({
      google: false,
      claude: false,
      cartesia: false,
      kie: false,
    });
  }, []);

  return status;
};

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>({
    scriptTemplate: "dramatic",
    voice: "british-male",
    imageModel: "historical-v2",
    imageCount: 10,
  });
  const [processingSteps, setProcessingSteps] = useState<GenerationStep[]>([]);

  const apiStatus = useApiKeyStatus();
  const allApisReady = apiStatus.google && apiStatus.claude && apiStatus.cartesia && apiStatus.kie;

  const toggleInputMode = () => {
    setInputMode(prev => prev === "url" ? "title" : "url");
    setInputValue("");
  };

  const handleGenerate = async () => {
    if (!inputValue.trim()) {
      toast({
        title: inputMode === "url" ? "URL Required" : "Title Required",
        description: inputMode === "url" 
          ? "Please paste a YouTube URL to generate." 
          : "Please enter a video title to generate.",
        variant: "destructive",
      });
      return;
    }

    if (inputMode === "url") {
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
      if (!youtubeRegex.test(inputValue)) {
        toast({
          title: "Invalid URL",
          description: "Please enter a valid YouTube URL.",
          variant: "destructive",
        });
        return;
      }
    }

    // Initialize processing steps
    const steps: GenerationStep[] = [
      { id: "script", label: "Rewriting Script (Claude)", status: "pending" },
      { id: "audio", label: "Generating Audio (Cartesia)", status: "pending" },
      { 
        id: "images", 
        label: "Generating Images (Kie.ai)", 
        sublabel: `Creating ${settings.imageCount} images using ${
          settings.imageModel === "historical-v2" ? "Historical Realism v2" : settings.imageModel
        }...`,
        status: "pending" 
      },
      { id: "video", label: "Assembling Scene Videos", status: "pending" },
      { id: "captions", label: "Generating SRT Captions", status: "pending" },
    ];

    setProcessingSteps(steps);
    setIsProcessing(true);

    // Simulate processing each step
    for (let i = 0; i < steps.length; i++) {
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === i ? "active" : idx < i ? "completed" : "pending"
      })));
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Mark all as completed
    setProcessingSteps(prev => prev.map(step => ({ ...step, status: "completed" as const })));
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setIsProcessing(false);
    toast({
      title: "Generation Complete!",
      description: "Your history video assets are ready.",
    });
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

          {/* URL/Title Input */}
          <div className="bg-card rounded-2xl shadow-sm border border-border p-2 flex items-center gap-2">
            <button
              onClick={toggleInputMode}
              className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-xl hover:bg-secondary transition-colors cursor-pointer"
            >
              {inputMode === "url" ? (
                <Youtube className="w-5 h-5 text-red-500" />
              ) : (
                <FileText className="w-5 h-5 text-primary" />
              )}
              <span className="text-sm font-medium text-muted-foreground">
                {inputMode === "url" ? "URL" : "Title"}
              </span>
            </button>
            
            <Input
              type={inputMode === "url" ? "url" : "text"}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={inputMode === "url" ? "Paste YouTube URL..." : "Enter Video Title..."}
              className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base placeholder:text-muted-foreground/60"
            />
            
            <SettingsPopover settings={settings} onSettingsChange={setSettings} />
            
            <Button
              onClick={handleGenerate}
              disabled={isProcessing}
              className="shrink-0 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground rounded-xl px-5"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generate
            </Button>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <StatusIndicator name="Google Ready" isReady={apiStatus.google} />
            <StatusIndicator name="Claude Ready" isReady={apiStatus.claude} />
            <StatusIndicator name="Cartesia Ready" isReady={apiStatus.cartesia} />
            <StatusIndicator name="Kie Ready" isReady={apiStatus.kie} />
          </div>
        </div>
      </main>

      {/* Processing Modal */}
      <ProcessingModal 
        isOpen={isProcessing} 
        onClose={() => {}} 
        steps={processingSteps}
      />
    </div>
  );
};

export default Index;