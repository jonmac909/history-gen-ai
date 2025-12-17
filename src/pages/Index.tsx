import { useState } from "react";
import { Youtube, FileText, Sparkles, Scroll, Mic, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { SettingsPopover, type GenerationSettings } from "@/components/SettingsPopover";
import { ProcessingModal, type GenerationStep } from "@/components/ProcessingModal";
import { ConfigModal, type ScriptTemplate, type CartesiaVoice } from "@/components/ConfigModal";
import { ProjectResults, type GeneratedAsset } from "@/components/ProjectResults";
import { ScriptReviewModal } from "@/components/ScriptReviewModal";
import { AudioPreviewModal } from "@/components/AudioPreviewModal";
import { CaptionsPreviewModal } from "@/components/CaptionsPreviewModal";
import { ImagesPreviewModal } from "@/components/ImagesPreviewModal";
import { 
  getYouTubeTranscript, 
  rewriteScriptStreaming, 
  generateAudioStreaming,
  generateImagesStreaming,
  generateCaptions,
  saveScriptToStorage 
} from "@/lib/api";
import { defaultTemplates } from "@/data/defaultTemplates";

type InputMode = "url" | "title";
type ViewState = "create" | "processing" | "review-script" | "review-audio" | "review-captions" | "review-images" | "results";

// Generate image prompts evenly spaced throughout the script
function generateImagePrompts(script: string, imageCount: number, stylePrompt: string): string[] {
  const sentences = script.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
  
  if (sentences.length === 0) {
    const paragraphs = script.split(/\n\n+/).filter(p => p.trim().length > 50);
    const sectionSize = Math.max(1, Math.ceil(paragraphs.length / imageCount));
    
    const prompts: string[] = [];
    for (let i = 0; i < imageCount && i * sectionSize < paragraphs.length; i++) {
      const startIdx = i * sectionSize;
      const section = paragraphs.slice(startIdx, startIdx + sectionSize).join(' ');
      const context = section.substring(0, 300).replace(/\n/g, ' ');
      prompts.push(`${stylePrompt}. Scene depicting: ${context}`);
    }
    return prompts;
  }
  
  const spacing = sentences.length / imageCount;
  const prompts: string[] = [];
  
  for (let i = 0; i < imageCount; i++) {
    const sentenceIndex = Math.floor(i * spacing);
    const contextStart = Math.max(0, sentenceIndex - 1);
    const contextEnd = Math.min(sentences.length, sentenceIndex + 2);
    const context = sentences.slice(contextStart, contextEnd).join(' ').substring(0, 300);
    prompts.push(`${stylePrompt}. Scene depicting: ${context}`);
  }
  
  return prompts;
}

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [viewState, setViewState] = useState<ViewState>("create");
  const [settings, setSettings] = useState<GenerationSettings>({
    scriptTemplate: "template-a",
    aiModel: "claude-sonnet-4-5",
    voiceSampleUrl: null,
    speed: 1,
    imageCount: 10,
    wordCount: 1000,
    quality: "basic",
  });
  const [processingSteps, setProcessingSteps] = useState<GenerationStep[]>([]);
  const [scriptTemplates, setScriptTemplates] = useState<ScriptTemplate[]>(defaultTemplates);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoice[]>([]);
  const [imageStylePrompt, setImageStylePrompt] = useState("Epic Rembrandt-style traditional oil painting with visible brushstrokes, painterly technique, impressionistic rather than photorealistic, dramatic chiaroscuro lighting with deep shadows and warm golden highlights, museum-quality classical aesthetic, rich warm amber, deep teal, and crimson red tones, smooth glowing light sources, and a loose, expressive oil-painting texture throughout.");
  const [sourceUrl, setSourceUrl] = useState("");
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | undefined>();
  const [srtContent, setSrtContent] = useState<string | undefined>();
  
  // Step-by-step state
  const [pendingScript, setPendingScript] = useState("");
  const [confirmedScript, setConfirmedScript] = useState("");
  const [projectId, setProjectId] = useState("");
  const [videoTitle, setVideoTitle] = useState("History Documentary");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  const [pendingAudioDuration, setPendingAudioDuration] = useState<number>(0);
  const [pendingAudioSize, setPendingAudioSize] = useState<number>(0);
  const [pendingSrtContent, setPendingSrtContent] = useState("");
  const [pendingSrtUrl, setPendingSrtUrl] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);

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

  // Step 1: Generate transcript and script
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

    const currentTemplate = scriptTemplates.find(t => t.id === settings.scriptTemplate);
    if (!currentTemplate?.template) {
      toast({
        title: "Template Required",
        description: "Please configure a script template in Settings.",
        variant: "destructive",
      });
      return;
    }

    if (!settings.voiceSampleUrl) {
      toast({
        title: "Voice Sample Required",
        description: "Please upload a voice sample for cloning in Settings.",
        variant: "destructive",
      });
      return;
    }

    setSourceUrl(inputValue);
    const newProjectId = crypto.randomUUID();
    setProjectId(newProjectId);

    const steps: GenerationStep[] = [
      { id: "transcript", label: "Fetching YouTube Transcript", status: "pending" },
      { id: "script", label: "Rewriting Script", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");
    resetPendingState();

    try {
      updateStep("transcript", "active");
      const transcriptResult = await getYouTubeTranscript(inputValue);
      
      if (!transcriptResult.success || !transcriptResult.transcript) {
        throw new Error(transcriptResult.message || transcriptResult.error || "Failed to fetch transcript");
      }
      
      const transcript = transcriptResult.transcript;
      setVideoTitle(transcriptResult.title || "History Documentary");
      updateStep("transcript", "completed");

      updateStep("script", "active", "0%");

      const scriptResult = await rewriteScriptStreaming(
        transcript, 
        currentTemplate.template, 
        transcriptResult.title || "History Documentary",
        settings.aiModel,
        settings.wordCount,
        (progress, wordCount) => {
          updateStep("script", "active", `${progress}% (${wordCount.toLocaleString()} words)`);
        }
      );
      
      if (!scriptResult.success || !scriptResult.script) {
        throw new Error(scriptResult.error || "Failed to rewrite script");
      }
      
      updateStep("script", "completed");
      setPendingScript(scriptResult.script);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      setViewState("review-script");

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

  // Step 2: After script confirmed, generate audio
  const handleScriptConfirm = async (script: string) => {
    setConfirmedScript(script);

    const steps: GenerationStep[] = [
      { id: "audio", label: "Generating Audio with Chatterbox", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      await saveScriptToStorage(script, projectId);

      updateStep("audio", "active", "0%");
      const audioRes = await generateAudioStreaming(
        script, 
        settings.voiceSampleUrl!, 
        projectId,
        (progress) => {
          updateStep("audio", "active", `${progress}%`);
        }
      );
      
      if (!audioRes.success || !audioRes.audioUrl) {
        throw new Error(audioRes.error || "Failed to generate audio");
      }
      
      updateStep("audio", "completed", "100%");
      
      setPendingAudioUrl(audioRes.audioUrl);
      setPendingAudioDuration(audioRes.duration || 0);
      setPendingAudioSize(audioRes.size || 0);

      await new Promise(resolve => setTimeout(resolve, 300));
      setViewState("review-audio");

    } catch (error) {
      console.error("Audio generation error:", error);
      toast({
        title: "Audio Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  // Regenerate audio
  const handleAudioRegenerate = () => {
    handleScriptConfirm(confirmedScript);
  };

  // Step 3: After audio confirmed, generate captions
  const handleAudioConfirm = async () => {
    const steps: GenerationStep[] = [
      { id: "captions", label: "Generating SRT Captions", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      updateStep("captions", "active");
      const captionsRes = await generateCaptions(pendingAudioUrl, projectId);
      
      if (!captionsRes.success || !captionsRes.srtContent) {
        throw new Error(captionsRes.error || "Failed to generate captions");
      }
      
      updateStep("captions", "completed");
      
      setPendingSrtContent(captionsRes.srtContent);
      setPendingSrtUrl(captionsRes.captionsUrl || "");

      await new Promise(resolve => setTimeout(resolve, 300));
      setViewState("review-captions");

    } catch (error) {
      console.error("Captions generation error:", error);
      toast({
        title: "Captions Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  // Step 4: After captions confirmed, generate images
  const handleCaptionsConfirm = async (srt: string) => {
    setPendingSrtContent(srt);

    const steps: GenerationStep[] = [
      { id: "images", label: "Generating Images", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      updateStep("images", "active", `0/${settings.imageCount}`);
      
      const imagePrompts = generateImagePrompts(confirmedScript, settings.imageCount, imageStylePrompt);
      console.log(`Generating ${imagePrompts.length} images...`);
      
      const imageResult = await generateImagesStreaming(
        imagePrompts, 
        settings.quality,
        "16:9",
        (completed, total) => {
          updateStep("images", "active", `${completed}/${total}`);
        }
      );
      
      if (!imageResult.success) {
        console.error('Image generation failed:', imageResult.error);
        toast({
          title: "Image Generation Issue",
          description: imageResult.error || "Some images may not have generated",
          variant: "destructive",
        });
      }

      updateStep("images", "completed", "Done");
      setPendingImages(imageResult.images || []);

      await new Promise(resolve => setTimeout(resolve, 300));
      setViewState("review-images");

    } catch (error) {
      console.error("Image generation error:", error);
      toast({
        title: "Image Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  // Step 5: Complete - show results
  const handleImagesConfirm = () => {
    const assets: GeneratedAsset[] = [
      {
        id: "script",
        name: "Rewritten Script",
        type: "Markdown",
        size: `${Math.round(confirmedScript.length / 1024)} KB`,
        icon: <FileText className="w-5 h-5 text-muted-foreground" />,
        content: confirmedScript,
      },
      {
        id: "audio",
        name: "Voiceover Audio",
        type: "MP3",
        size: pendingAudioSize ? `${(pendingAudioSize / (1024 * 1024)).toFixed(1)} MB` : "Unknown",
        icon: <Mic className="w-5 h-5 text-muted-foreground" />,
        url: pendingAudioUrl,
      },
      {
        id: "captions",
        name: "Captions",
        type: "SRT",
        size: pendingSrtContent ? `${Math.round(pendingSrtContent.length / 1024)} KB` : "Unknown",
        icon: <FileText className="w-5 h-5 text-muted-foreground" />,
        url: pendingSrtUrl,
        content: pendingSrtContent,
      },
    ];

    pendingImages.forEach((imageUrl, index) => {
      assets.push({
        id: `image-${index + 1}`,
        name: `Image ${index + 1}`,
        type: "PNG",
        size: "~1 MB",
        icon: <Image className="w-5 h-5 text-muted-foreground" />,
        url: imageUrl,
      });
    });

    setGeneratedAssets(assets);
    setAudioUrl(pendingAudioUrl);
    setSrtContent(pendingSrtContent);
    setViewState("results");
    
    toast({
      title: "Generation Complete!",
      description: "Your history video assets are ready.",
    });
  };

  const resetPendingState = () => {
    setGeneratedAssets([]);
    setAudioUrl(undefined);
    setSrtContent(undefined);
    setPendingScript("");
    setConfirmedScript("");
    setPendingAudioUrl("");
    setPendingAudioDuration(0);
    setPendingAudioSize(0);
    setPendingSrtContent("");
    setPendingSrtUrl("");
    setPendingImages([]);
  };

  const handleCancel = () => {
    resetPendingState();
    setViewState("create");
    toast({
      title: "Generation Cancelled",
      description: "Process was cancelled.",
    });
  };

  const handleNewProject = () => {
    setViewState("create");
    setInputValue("");
    setSourceUrl("");
    resetPendingState();
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
          srtContent={srtContent}
        />
      ) : (
        <main className="flex flex-col items-center justify-center px-4 py-32">
          <div className="w-full max-w-3xl mx-auto text-center space-y-8">
            <div className="space-y-3">
              <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight">
                Create Your History AI Video
              </h1>
              <p className="text-lg text-muted-foreground">
                From YouTube URL to full production ready assets in minutes.
              </p>
            </div>

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
              />
              
              <Button
                onClick={handleGenerate}
                disabled={viewState !== "create"}
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

      {/* Script Review Modal */}
      <ScriptReviewModal
        isOpen={viewState === "review-script"}
        script={pendingScript}
        onConfirm={handleScriptConfirm}
        onCancel={handleCancel}
      />

      {/* Audio Preview Modal */}
      <AudioPreviewModal
        isOpen={viewState === "review-audio"}
        audioUrl={pendingAudioUrl}
        duration={pendingAudioDuration}
        onConfirm={handleAudioConfirm}
        onRegenerate={handleAudioRegenerate}
        onCancel={handleCancel}
      />

      {/* Captions Preview Modal */}
      <CaptionsPreviewModal
        isOpen={viewState === "review-captions"}
        srtContent={pendingSrtContent}
        onConfirm={handleCaptionsConfirm}
        onCancel={handleCancel}
      />

      {/* Images Preview Modal */}
      <ImagesPreviewModal
        isOpen={viewState === "review-images"}
        images={pendingImages}
        onConfirm={handleImagesConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default Index;
