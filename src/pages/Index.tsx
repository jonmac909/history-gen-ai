import { useState } from "react";
import { Youtube, FileText, Sparkles, Scroll, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { SettingsPopover, type GenerationSettings } from "@/components/SettingsPopover";
import { ProcessingModal, type GenerationStep } from "@/components/ProcessingModal";
import { ConfigModal, type ScriptTemplate, type CartesiaVoice } from "@/components/ConfigModal";
import { ProjectResults, type GeneratedAsset } from "@/components/ProjectResults";
import { 
  getYouTubeTranscript, 
  rewriteScript, 
  generateAudio, 
  generateCaptions,
  saveScriptToStorage 
} from "@/lib/api";

type InputMode = "url" | "title";
type ViewState = "create" | "processing" | "results";

// Default script templates
const defaultTemplates: ScriptTemplate[] = [
  { id: "template-a", name: "", description: "", template: "" },
  { id: "template-b", name: "", description: "", template: "" },
  { id: "template-c", name: "", description: "", template: "" },
];

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [viewState, setViewState] = useState<ViewState>("create");
  const [settings, setSettings] = useState<GenerationSettings>({
    scriptTemplate: "template-a",
    voice: "voice-slow",
    imageCount: 10,
    quality: "basic",
  });
  const [processingSteps, setProcessingSteps] = useState<GenerationStep[]>([]);
  const [scriptTemplates, setScriptTemplates] = useState<ScriptTemplate[]>(defaultTemplates);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoice[]>([
    { id: "voice-slow", name: "Slow", voiceId: "46ff9204-c326-44e3-82ae-c1eaa07ba71c" },
    { id: "voice-sleepy", name: "Sleepy", voiceId: "2f196c8c-9afa-4d7d-9287-151e05592bbf" },
  ]);
  const [imageStylePrompt, setImageStylePrompt] = useState("Epic Rembrandt-style traditional oil painting with visible brushstrokes, painterly technique, impressionistic rather than photorealistic, dramatic chiaroscuro lighting with deep shadows and warm golden highlights, museum-quality classical aesthetic, rich warm amber, deep teal, and crimson red tones, smooth glowing light sources, and a loose, expressive oil-painting texture throughout.");
  const [sourceUrl, setSourceUrl] = useState("");
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | undefined>();

  const toggleInputMode = () => {
    setInputMode(prev => prev === "url" ? "title" : "url");
    setInputValue("");
  };

  const handleSaveTemplates = (templates: ScriptTemplate[]) => {
    setScriptTemplates(templates);
  };

  const handleSaveVoices = (voices: CartesiaVoice[]) => {
    setCartesiaVoices(voices);
  };

  const handleSaveImageStylePrompt = (prompt: string) => {
    setImageStylePrompt(prompt);
  };

  const updateStep = (stepId: string, status: "pending" | "active" | "completed", sublabel?: string) => {
    setProcessingSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, status, sublabel: sublabel || step.sublabel }
        : step
    ));
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

    // Check for required configuration
    const currentTemplate = scriptTemplates.find(t => t.id === settings.scriptTemplate);
    if (!currentTemplate?.template) {
      toast({
        title: "Template Required",
        description: "Please configure a script template in Settings.",
        variant: "destructive",
      });
      return;
    }

    const selectedVoice = cartesiaVoices.find(v => v.id === settings.voice);
    if (!selectedVoice) {
      toast({
        title: "Voice Required",
        description: "Please add and select a Cartesia voice in Settings.",
        variant: "destructive",
      });
      return;
    }

    setSourceUrl(inputValue);
    const projectId = crypto.randomUUID();

    // Initialize processing steps
    const steps: GenerationStep[] = [
      { id: "transcript", label: "Fetching YouTube Transcript", status: "pending" },
      { id: "script", label: "Rewriting Script (Claude)", status: "pending" },
      { id: "audio", label: "Generating Audio (Cartesia)", status: "pending" },
      { id: "captions", label: "Generating SRT Captions", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");
    setGeneratedAssets([]);
    setAudioUrl(undefined);

    let transcript = "";
    let videoTitle = "History Documentary";
    let script = "";
    let audioResult: { audioUrl?: string; duration?: number; size?: number } = {};
    let captionsResult: { captionsUrl?: string; srtContent?: string } = {};

    try {
      // Step 1: Fetch transcript
      updateStep("transcript", "active");
      const transcriptResult = await getYouTubeTranscript(inputValue);
      
      if (!transcriptResult.success || !transcriptResult.transcript) {
        throw new Error(transcriptResult.message || transcriptResult.error || "Failed to fetch transcript");
      }
      
      transcript = transcriptResult.transcript;
      videoTitle = transcriptResult.title || videoTitle;
      updateStep("transcript", "completed");

      // Step 2: Rewrite script
      updateStep("script", "active");
      const scriptResult = await rewriteScript(transcript, currentTemplate.template, videoTitle);
      
      if (!scriptResult.success || !scriptResult.script) {
        throw new Error(scriptResult.error || "Failed to rewrite script");
      }
      
      script = scriptResult.script;
      updateStep("script", "completed");

      // Save script to storage
      const scriptUrl = await saveScriptToStorage(script, projectId);

      // Step 3: Generate audio
      updateStep("audio", "active");
      const audioRes = await generateAudio(script, selectedVoice.voiceId, projectId);
      
      if (!audioRes.success) {
        throw new Error(audioRes.error || "Failed to generate audio");
      }
      
      audioResult = audioRes;
      updateStep("audio", "completed");

      // Step 4: Generate captions
      updateStep("captions", "active");
      const captionsRes = await generateCaptions(script, audioRes.duration || 0, projectId);
      
      if (!captionsRes.success) {
        throw new Error(captionsRes.error || "Failed to generate captions");
      }
      
      captionsResult = captionsRes;
      updateStep("captions", "completed");

      // Prepare assets
      const assets: GeneratedAsset[] = [
        {
          id: "script",
          name: "Rewritten Script (Claude)",
          type: "Markdown",
          size: `${Math.round(script.length / 1024)} KB`,
          icon: <FileText className="w-5 h-5 text-muted-foreground" />,
          url: scriptUrl || undefined,
          content: script,
        },
        {
          id: "audio",
          name: "Voiceover Audio (Cartesia)",
          type: "MP3",
          size: audioResult.size ? `${(audioResult.size / (1024 * 1024)).toFixed(1)} MB` : "Unknown",
          icon: <Mic className="w-5 h-5 text-muted-foreground" />,
          url: audioResult.audioUrl,
        },
        {
          id: "captions",
          name: "Captions",
          type: "SRT",
          size: captionsResult.srtContent ? `${Math.round(captionsResult.srtContent.length / 1024)} KB` : "Unknown",
          icon: <FileText className="w-5 h-5 text-muted-foreground" />,
          url: captionsResult.captionsUrl,
          content: captionsResult.srtContent,
        },
      ];

      setGeneratedAssets(assets);
      setAudioUrl(audioResult.audioUrl);

      // Short delay before showing results
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setViewState("results");
      toast({
        title: "Generation Complete!",
        description: "Your history video assets are ready.",
      });

    } catch (error) {
      console.error("Generation error:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred during generation.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  const handleNewProject = () => {
    setViewState("create");
    setInputValue("");
    setSourceUrl("");
    setGeneratedAssets([]);
    setAudioUrl(undefined);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
              <Scroll className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">
              HistoryGen AI
            </span>
          </div>
          
          <ConfigModal 
            scriptTemplates={scriptTemplates}
            onSaveTemplates={handleSaveTemplates}
            cartesiaVoices={cartesiaVoices}
            onSaveVoices={handleSaveVoices}
            imageStylePrompt={imageStylePrompt}
            onSaveImageStylePrompt={handleSaveImageStylePrompt}
          />
        </div>
      </header>

      {/* Main Content */}
      {viewState === "results" ? (
        <ProjectResults 
          sourceUrl={sourceUrl} 
          onNewProject={handleNewProject}
          assets={generatedAssets}
          audioUrl={audioUrl}
        />
      ) : (
        <main className="flex flex-col items-center justify-center px-4 py-32">
          <div className="w-full max-w-3xl mx-auto text-center space-y-8">
            {/* Title */}
            <div className="space-y-3">
              <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight">
                Create Your History AI Video
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
              
              <SettingsPopover 
                settings={settings} 
                onSettingsChange={setSettings}
                scriptTemplates={scriptTemplates}
                cartesiaVoices={cartesiaVoices}
              />
              
              <Button
                onClick={handleGenerate}
                disabled={viewState === "processing"}
                className="shrink-0 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground rounded-xl px-5"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate
              </Button>
            </div>

          </div>
        </main>
      )}

      {/* Processing Modal */}
      <ProcessingModal 
        isOpen={viewState === "processing"} 
        onClose={() => {}} 
        steps={processingSteps}
      />
    </div>
  );
};

export default Index;
