import { useState, useRef } from "react";
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
import { AudioSegmentsPreviewModal } from "@/components/AudioSegmentsPreviewModal";
import { CaptionsPreviewModal } from "@/components/CaptionsPreviewModal";
import { ImagesPreviewModal } from "@/components/ImagesPreviewModal";
import {
  getYouTubeTranscript,
  rewriteScriptStreaming,
  generateAudioStreaming,
  regenerateAudioSegment,
  generateImagesStreaming,
  generateImagePrompts,
  generateCaptions,
  saveScriptToStorage,
  type ImagePromptWithTiming,
  type AudioSegment,
} from "@/lib/api";
import { defaultTemplates } from "@/data/defaultTemplates";

type InputMode = "url" | "title";
type ViewState = "create" | "processing" | "review-script" | "review-audio" | "review-captions" | "review-images" | "results";

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
  const [imageStylePrompt, setImageStylePrompt] = useState("Warm classical oil-painting style, inspired by Dutch Golden Age domestic interiors. Soft, intimate chiaroscuro with lifted shadows and glowing midtones, avoiding harsh contrast. Rich, earthy palette of warm reds, ochres, umbers, and deep teal-blues. Painterly brushwork with visible texture and gentle edges. Quiet, reverent, contemplative mood. Old-world, timeless atmosphere with a sense of stillness, intimacy, and human warmth. Romantic historical painting sensibility with softened realism. Gentle, peaceful tone — not scary, not violent, family-safe. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation");
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
  // New: Audio segments state
  const [pendingAudioSegments, setPendingAudioSegments] = useState<AudioSegment[]>([]);
  const [regeneratingSegmentIndex, setRegeneratingSegmentIndex] = useState<number | null>(null);
  const [pendingSrtContent, setPendingSrtContent] = useState("");
  const [pendingSrtUrl, setPendingSrtUrl] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [imagePrompts, setImagePrompts] = useState<ImagePromptWithTiming[]>([]);
  const [regeneratingImageIndex, setRegeneratingImageIndex] = useState<number | undefined>();

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
    // Check if using custom script (skip YouTube fetch and AI rewriting)
    const usingCustomScript = settings.customScript && settings.customScript.trim().length > 0;

    if (usingCustomScript) {
      // Using custom script - skip to audio generation
      if (!settings.voiceSampleUrl) {
        toast({
          title: "Voice Sample Required",
          description: "Please upload a voice sample for cloning in Settings.",
          variant: "destructive",
        });
        return;
      }

      // Set up project with custom script
      setSourceUrl("Custom Script");
      const newProjectId = crypto.randomUUID();
      setProjectId(newProjectId);
      setVideoTitle("Custom Script");

      // Go straight to script review with custom script
      setPendingScript(settings.customScript!);
      setViewState("review-script");
      return;
    }

    // Normal flow - validate inputs for YouTube/AI generation
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
          // Show only progress percentage and word count (no script preview)
          const progressText = `${progress}% (${wordCount.toLocaleString()} words)`;
          updateStep("script", "active", progressText);
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

  // Step 2: After script confirmed, generate audio (6 segments)
  const handleScriptConfirm = async (script: string) => {
    setConfirmedScript(script);

    const steps: GenerationStep[] = [
      { id: "audio", label: "Generating Audio with Chatterbox (6 segments)", status: "pending" },
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
        (progress, message) => {
          updateStep("audio", "active", message || `${progress}%`);
        }
      );

      if (!audioRes.success) {
        throw new Error(audioRes.error || "Failed to generate audio");
      }

      updateStep("audio", "completed", "100%");

      // Handle audio response - prefer combined audioUrl for captions
      if (audioRes.audioUrl) {
        // Use combined audio URL for playback and captions
        setPendingAudioUrl(audioRes.audioUrl);
        setPendingAudioDuration(audioRes.duration || audioRes.totalDuration || 0);
        setPendingAudioSize(audioRes.size || 0);
        // Store segments for individual regeneration if available
        if (audioRes.segments && audioRes.segments.length > 0) {
          setPendingAudioSegments(audioRes.segments);
        } else {
          setPendingAudioSegments([]);
        }
      } else if (audioRes.segments && audioRes.segments.length > 0) {
        // Fallback: no combined URL, use first segment (shouldn't happen with new backend)
        console.warn("No combined audioUrl, falling back to first segment");
        setPendingAudioSegments(audioRes.segments);
        setPendingAudioDuration(audioRes.totalDuration || 0);
        const totalSize = audioRes.segments.reduce((sum, seg) => sum + seg.size, 0);
        setPendingAudioSize(totalSize);
        setPendingAudioUrl(audioRes.segments[0].audioUrl);
      } else {
        throw new Error("No audio generated");
      }

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

  // Regenerate audio (all segments)
  const handleAudioRegenerate = () => {
    handleScriptConfirm(confirmedScript);
  };

  // Regenerate a single audio segment
  const handleSegmentRegenerate = async (segmentIndex: number) => {
    const segment = pendingAudioSegments.find(s => s.index === segmentIndex);
    if (!segment) {
      toast({
        title: "Error",
        description: "Segment not found",
        variant: "destructive",
      });
      return;
    }

    setRegeneratingSegmentIndex(segmentIndex);

    try {
      console.log(`Regenerating segment ${segmentIndex}...`);

      const result = await regenerateAudioSegment(
        segment.text,
        segmentIndex,
        settings.voiceSampleUrl!,
        projectId
      );

      if (!result.success || !result.segment) {
        throw new Error(result.error || "Failed to regenerate segment");
      }

      // Update the segment in the array
      setPendingAudioSegments(prev => {
        const newSegments = [...prev];
        const idx = newSegments.findIndex(s => s.index === segmentIndex);
        if (idx !== -1) {
          newSegments[idx] = result.segment!;
        }
        return newSegments;
      });

      // Recalculate totals
      const newTotalDuration = pendingAudioSegments.reduce((sum, seg) => {
        if (seg.index === segmentIndex) {
          return sum + result.segment!.duration;
        }
        return sum + seg.duration;
      }, 0);
      setPendingAudioDuration(newTotalDuration);

      toast({
        title: "Segment Regenerated",
        description: `Segment ${segmentIndex} has been regenerated successfully.`,
      });

    } catch (error) {
      console.error("Segment regeneration error:", error);
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Failed to regenerate segment",
        variant: "destructive",
      });
    } finally {
      setRegeneratingSegmentIndex(null);
    }
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
      const captionsRes = await generateCaptions(
        pendingAudioUrl,
        projectId,
        (progress) => {
          // Update progress in real-time as chunks are transcribed
          updateStep("captions", "active", `${progress}%`);
        }
      );

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
      { id: "prompts", label: "Generating Scene Descriptions", status: "pending" },
      { id: "images", label: "Generating Images", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      // Step 1: Use AI to generate proper visual scene descriptions from script + SRT timing
      updateStep("prompts", "active", "Analyzing script...");

      const promptResult = await generateImagePrompts(
        confirmedScript,
        srt,
        settings.imageCount,
        imageStylePrompt,
        pendingAudioDuration // Pass actual audio duration to ensure images cover full audio
      );

      if (!promptResult.success || !promptResult.prompts) {
        throw new Error(promptResult.error || "Failed to generate image prompts");
      }

      console.log(`Generated ${promptResult.prompts.length} AI-powered image prompts with timing`);
      setImagePrompts(promptResult.prompts);
      updateStep("prompts", "completed", `${promptResult.prompts.length} scenes`);

      // Step 2: Generate images from the AI prompts with timing-based filenames
      updateStep("images", "active", `0/${promptResult.prompts.length}`);

      const imageResult = await generateImagesStreaming(
        promptResult.prompts,
        settings.quality,
        "16:9",
        (completed, total) => {
          updateStep("images", "active", `${completed}/${total}`);
        },
        projectId
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

  // Regenerate a single image
  const handleRegenerateImage = async (index: number) => {
    if (!imagePrompts[index]) {
      toast({
        title: "Error",
        description: "Image prompt not found",
        variant: "destructive",
      });
      return;
    }

    setRegeneratingImageIndex(index);

    try {
      console.log(`Regenerating image ${index + 1}...`);

      const imageResult = await generateImagesStreaming(
        [imagePrompts[index]], // Regenerate just this one prompt with timing
        settings.quality,
        "16:9",
        () => {}, // No progress callback needed for single image
        projectId
      );

      if (!imageResult.success || !imageResult.images || imageResult.images.length === 0) {
        throw new Error(imageResult.error || 'Failed to regenerate image');
      }

      // Update the image at the specific index
      setPendingImages(prev => {
        const newImages = [...prev];
        newImages[index] = imageResult.images![0];
        return newImages;
      });

      toast({
        title: "Image Regenerated",
        description: `Image ${index + 1} has been regenerated successfully.`,
      });

    } catch (error) {
      console.error("Image regeneration error:", error);
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Failed to regenerate image",
        variant: "destructive",
      });
    } finally {
      setRegeneratingImageIndex(undefined);
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
    setPendingAudioSegments([]);
    setRegeneratingSegmentIndex(null);
    setPendingSrtContent("");
    setPendingSrtUrl("");
    setPendingImages([]);
    setImagePrompts([]);
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
              HistoryVidGen
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
                {settings.customScript && settings.customScript.trim().length > 0
                  ? "Using custom script - click Generate to start audio production"
                  : "From YouTube URL to full production ready assets in minutes"}
              </p>
            </div>

            {settings.customScript && settings.customScript.trim().length > 0 ? (
              // Custom script mode - simplified UI
              <div className="bg-card rounded-2xl shadow-sm border border-border p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-foreground">
                        Custom Script Ready
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {settings.customScript.trim().split(/\s+/).length} words
                      </p>
                    </div>
                  </div>
                  <SettingsPopover
                    settings={settings}
                    onSettingsChange={setSettings}
                    scriptTemplates={scriptTemplates}
                  />
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={viewState !== "create"}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl py-6 text-base"
                >
                  <Mic className="w-5 h-5 mr-2" />
                  Generate Audio from Custom Script
                </Button>
              </div>
            ) : (
              // Normal mode - YouTube URL input
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
            )}
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

      {/* Audio Preview Modal - Show segments modal if we have segments, otherwise legacy single audio */}
      {pendingAudioSegments.length > 0 ? (
        <AudioSegmentsPreviewModal
          isOpen={viewState === "review-audio"}
          segments={pendingAudioSegments}
          onConfirmAll={handleAudioConfirm}
          onRegenerate={handleSegmentRegenerate}
          onCancel={handleCancel}
          regeneratingIndex={regeneratingSegmentIndex}
        />
      ) : (
        <AudioPreviewModal
          isOpen={viewState === "review-audio"}
          audioUrl={pendingAudioUrl}
          duration={pendingAudioDuration}
          onConfirm={handleAudioConfirm}
          onRegenerate={handleAudioRegenerate}
          onCancel={handleCancel}
        />
      )}

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
        onRegenerate={handleRegenerateImage}
        regeneratingIndex={regeneratingImageIndex}
      />
    </div>
  );
};

export default Index;
