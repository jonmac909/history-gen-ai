import { useState, useRef, useEffect } from "react";
import { Youtube, FileText, Sparkles, Scroll, Mic, Image, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingsPopover, type GenerationSettings } from "@/components/SettingsPopover";
import { ProcessingModal, type GenerationStep } from "@/components/ProcessingModal";
import { ConfigModal, type ScriptTemplate, type ImageTemplate, type CartesiaVoice } from "@/components/ConfigModal";
import { ProjectResults, type GeneratedAsset } from "@/components/ProjectResults";
import { ScriptReviewModal } from "@/components/ScriptReviewModal";
import { AudioPreviewModal } from "@/components/AudioPreviewModal";
import { AudioSegmentsPreviewModal } from "@/components/AudioSegmentsPreviewModal";
import { ImagesPreviewModal } from "@/components/ImagesPreviewModal";
import { ImagePromptsPreviewModal } from "@/components/ImagePromptsPreviewModal";
import { ThumbnailGeneratorModal } from "@/components/ThumbnailGeneratorModal";
import { VideoRenderModal } from "@/components/VideoRenderModal";
import { YouTubeUploadModal } from "@/components/YouTubeUploadModal";
import {
  getYouTubeTranscript,
  rewriteScriptStreaming,
  generateAudioStreaming,
  regenerateAudioSegment,
  recombineAudioSegments,
  generateCaptions,
  generateImagesStreaming,
  generateImagePrompts,
  saveScriptToStorage,
  type ImagePromptWithTiming,
  type AudioSegment,
} from "@/lib/api";
import { defaultTemplates, defaultImageTemplates } from "@/data/defaultTemplates";
import { supabase } from "@/integrations/supabase/client";
import { saveProject, loadProject, clearProject, getStepLabel, addToProjectHistory, updateProjectInHistory, type SavedProject, type ProjectHistoryItem } from "@/lib/projectPersistence";
import { ProjectsDrawer } from "@/components/ProjectsDrawer";

type InputMode = "url" | "title";
type ViewState = "create" | "processing" | "review-script" | "review-audio" | "review-prompts" | "review-images" | "review-thumbnails" | "review-render" | "review-youtube" | "results";
type EntryMode = "script" | "captions" | "images";

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [viewState, setViewState] = useState<ViewState>("create");
  const [settings, setSettings] = useState<GenerationSettings>({
    projectTitle: "",
    fullAutomation: false,
    scriptTemplate: "template-a",
    imageTemplate: "image-a",
    aiModel: "claude-sonnet-4-5",
    voiceSampleUrl: "https://historygenai.netlify.app/voices/clone_voice.wav",
    speed: 1,
    imageCount: 10,
    wordCount: 1000,
    quality: "basic",
    // TTS settings (Fish Speech)
    ttsEmotionMarker: "(sincere) (soft tone)",
    ttsTemperature: 0.9,
    ttsTopP: 0.85,
    ttsRepetitionPenalty: 1.1,
  });
  const [processingSteps, setProcessingSteps] = useState<GenerationStep[]>([]);
  const [scriptTemplates, setScriptTemplates] = useState<ScriptTemplate[]>(defaultTemplates);
  const [imageTemplates, setImageTemplates] = useState<ImageTemplate[]>(defaultImageTemplates);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoice[]>([]);

  // Get the selected image template content for image generation
  const getSelectedImageStyle = () => {
    const selected = imageTemplates.find(t => t.id === settings.imageTemplate);
    return selected?.template || imageTemplates[0]?.template || "";
  };
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
  const [segmentsNeedRecombine, setSegmentsNeedRecombine] = useState(false);
  const [isRecombining, setIsRecombining] = useState(false);
  const [pendingSrtContent, setPendingSrtContent] = useState("");
  const [pendingSrtUrl, setPendingSrtUrl] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [videoUrlCaptioned, setVideoUrlCaptioned] = useState<string | undefined>();
  const [embersVideoUrl, setEmbersVideoUrl] = useState<string | undefined>();
  const [smokeEmbersVideoUrl, setSmokeEmbersVideoUrl] = useState<string | undefined>();
  const [imagePrompts, setImagePrompts] = useState<ImagePromptWithTiming[]>([]);
  const [regeneratingImageIndex, setRegeneratingImageIndex] = useState<number | undefined>();
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("script");
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const [uploadedScript, setUploadedScript] = useState("");
  const [uploadedCaptions, setUploadedCaptions] = useState("");
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputImagesRef = useRef<HTMLInputElement>(null);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const captionsFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedAudioFileForImages, setUploadedAudioFileForImages] = useState<File | null>(null);
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);
  const [captionsProjectTitle, setCaptionsProjectTitle] = useState("");
  const [imagesProjectTitle, setImagesProjectTitle] = useState("");

  // Check for saved project on load and when returning to create view
  useEffect(() => {
    if (viewState === "create") {
      const saved = loadProject();
      if (saved) {
        setSavedProject(saved);
      }
    }
  }, [viewState]);

  // Full Automation: Auto-confirm script when ready
  useEffect(() => {
    if (settings.fullAutomation && viewState === "review-script" && pendingScript) {
      console.log("[Full Automation] Auto-confirming script...");
      const timer = setTimeout(() => {
        handleScriptConfirm(pendingScript);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.fullAutomation, viewState, pendingScript]);

  // Full Automation: Auto-confirm audio when ready
  useEffect(() => {
    if (settings.fullAutomation && viewState === "review-audio" && pendingAudioUrl) {
      console.log("[Full Automation] Auto-confirming audio...");
      const timer = setTimeout(() => {
        handleAudioConfirm();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.fullAutomation, viewState, pendingAudioUrl]);

  // Full Automation: Auto-confirm captions when ready (captions step is now skipped automatically)

  // Full Automation: Auto-confirm prompts when ready
  useEffect(() => {
    if (settings.fullAutomation && viewState === "review-prompts" && imagePrompts.length > 0) {
      console.log("[Full Automation] Auto-confirming image prompts...");
      const timer = setTimeout(() => {
        handlePromptsConfirm(imagePrompts, getSelectedImageStyle());
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.fullAutomation, viewState, imagePrompts]);

  // Full Automation: Auto-confirm images when ready
  useEffect(() => {
    if (settings.fullAutomation && viewState === "review-images" && pendingImages.length > 0) {
      console.log("[Full Automation] Auto-confirming images...");
      const timer = setTimeout(() => {
        handleImagesConfirm();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.fullAutomation, viewState, pendingImages]);

  // Auto-save helper - accepts overrides for values that were just set
  const autoSave = (step: SavedProject["step"], overrides?: Partial<SavedProject>) => {
    const project: SavedProject = {
      id: overrides?.id || projectId,
      savedAt: Date.now(),
      sourceUrl: overrides?.sourceUrl || sourceUrl,
      videoTitle: overrides?.videoTitle || videoTitle,
      settings: overrides?.settings || settings,
      step,
      script: overrides?.script || confirmedScript || pendingScript,
      audioUrl: overrides?.audioUrl || pendingAudioUrl,
      audioDuration: overrides?.audioDuration || pendingAudioDuration,
      audioSegments: overrides?.audioSegments || pendingAudioSegments,
      srtContent: overrides?.srtContent || pendingSrtContent,
      srtUrl: overrides?.srtUrl || pendingSrtUrl,
      imagePrompts: overrides?.imagePrompts || imagePrompts,
      imageUrls: overrides?.imageUrls || pendingImages,
      videoUrl: overrides?.videoUrl || videoUrl,
      videoUrlCaptioned: overrides?.videoUrlCaptioned || videoUrlCaptioned,
    };
    saveProject(project);
    console.log(`Auto-saved project at step: ${step}`);
  };

  // Resume saved project
  const handleResumeProject = () => {
    if (!savedProject) return;

    // Restore state from saved project (but keep current settings so user can change them)
    setProjectId(savedProject.id);
    setSourceUrl(savedProject.sourceUrl);
    setVideoTitle(savedProject.videoTitle);
    // Don't restore settings - use current settings so user can adjust image count, etc.

    if (savedProject.script) {
      setPendingScript(savedProject.script);
      setConfirmedScript(savedProject.script);
    }
    if (savedProject.audioUrl) setPendingAudioUrl(savedProject.audioUrl);
    if (savedProject.audioDuration) setPendingAudioDuration(savedProject.audioDuration);
    if (savedProject.audioSegments) setPendingAudioSegments(savedProject.audioSegments);
    if (savedProject.srtContent) setPendingSrtContent(savedProject.srtContent);
    if (savedProject.srtUrl) setPendingSrtUrl(savedProject.srtUrl);
    if (savedProject.imagePrompts) setImagePrompts(savedProject.imagePrompts);
    if (savedProject.imageUrls) setPendingImages(savedProject.imageUrls);
    if (savedProject.videoUrl) setVideoUrl(savedProject.videoUrl);
    if (savedProject.videoUrlCaptioned) setVideoUrlCaptioned(savedProject.videoUrlCaptioned);
    if (savedProject.embersVideoUrl) setEmbersVideoUrl(savedProject.embersVideoUrl);
    if (savedProject.smokeEmbersVideoUrl) setSmokeEmbersVideoUrl(savedProject.smokeEmbersVideoUrl);

    // Navigate to the appropriate view based on saved step
    switch (savedProject.step) {
      case "script":
        setViewState("review-script");
        break;
      case "audio":
        setViewState("review-audio");
        break;
      case "captions":
        // Captions step removed - go to prompts instead
        setViewState("review-prompts");
        break;
      case "prompts":
        setViewState("review-prompts");
        break;
      case "images":
      case "complete":
        setViewState("review-images");
        break;
    }

    setSavedProject(null);
    toast({
      title: "Project Resumed",
      description: `Continuing from: ${getStepLabel(savedProject.step)}`,
    });
  };

  // Dismiss saved project
  const handleDismissSavedProject = () => {
    clearProject();
    setSavedProject(null);
  };

  const toggleInputMode = () => {
    setInputMode(prev => prev === "url" ? "title" : "url");
    setInputValue("");
  };

  const handleSaveScriptTemplates = (templates: ScriptTemplate[]) => {
    setScriptTemplates(templates);
  };

  const handleSaveImageTemplates = (templates: ImageTemplate[]) => {
    setImageTemplates(templates);
  };

  const handleSaveVoices = (voices: CartesiaVoice[]) => {
    setCartesiaVoices(voices);
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
      setVideoTitle(settings.projectTitle || "Custom Script");

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
      setVideoTitle(settings.projectTitle || transcriptResult.title || "History Documentary");
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

      // Auto-save after script generation
      autoSave("script", { script: scriptResult.script });

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
    // Update both pending and confirmed script so edits persist when navigating back
    setPendingScript(script);
    setConfirmedScript(script);

    const steps: GenerationStep[] = [
      { id: "audio", label: "Generating Audio", status: "pending" },
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
        },
        settings.speed,
        {
          emotionMarker: settings.ttsEmotionMarker,
          temperature: settings.ttsTemperature,
          topP: settings.ttsTopP,
          repetitionPenalty: settings.ttsRepetitionPenalty,
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

      // Auto-save after audio generation
      autoSave("audio", {
        audioUrl: audioRes.audioUrl || (audioRes.segments?.[0]?.audioUrl),
        audioDuration: audioRes.duration || audioRes.totalDuration || 0,
        audioSegments: audioRes.segments || [],
      });

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
  const handleSegmentRegenerate = async (segmentIndex: number, editedText?: string) => {
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

    // Use edited text if provided, otherwise use original segment text
    const textToUse = editedText || segment.text;

    try {
      console.log(`Regenerating segment ${segmentIndex}${editedText ? ' with edited text' : ''}...`);

      const result = await regenerateAudioSegment(
        textToUse,
        segmentIndex,
        settings.voiceSampleUrl!,
        projectId
      );

      if (!result.success || !result.segment) {
        throw new Error(result.error || "Failed to regenerate segment");
      }

      // Update the segment in the array (include new text if it was edited)
      setPendingAudioSegments(prev => {
        const newSegments = [...prev];
        const idx = newSegments.findIndex(s => s.index === segmentIndex);
        if (idx !== -1) {
          newSegments[idx] = {
            ...result.segment!,
            text: textToUse // Preserve the edited text in the segment
          };
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

      // Mark that combined audio needs to be recombined before generating captions
      setSegmentsNeedRecombine(true);

      toast({
        title: "Segment Regenerated",
        description: `Segment ${segmentIndex} has been regenerated. Click "Confirm Audio" to update captions.`,
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

  // Skip captions and go directly to image prompts
  const handleSkipCaptions = async () => {
    // Use script text as fallback for captions (for timing, prompts will be evenly distributed)
    const scriptAsSrt = confirmedScript || pendingScript || "";

    // Create a simple SRT from script (single segment spanning full duration)
    const duration = pendingAudioDuration || 60;
    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };

    const simpleSrt = `1\n${formatTime(0)} --> ${formatTime(duration)}\n${scriptAsSrt.substring(0, 500)}...\n`;

    setPendingSrtContent(simpleSrt);

    // Auto-save and go to prompts
    autoSave("captions", { srtContent: simpleSrt });

    // Call the captions confirm handler with the script as SRT
    await handleCaptionsConfirm(simpleSrt);
  };

  // Step 3: After audio confirmed, generate captions (for image timing) then go to image prompts
  const handleAudioConfirm = async () => {
    const steps: GenerationStep[] = [];

    // Add recombine step if segments were modified
    if (segmentsNeedRecombine) {
      steps.push({ id: "recombine", label: "Recombining audio segments", status: "pending" });
    }

    // Always add captions step (for accurate image timing)
    steps.push({ id: "captions", label: "Transcribing audio for image timing", status: "pending" });

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      let audioUrlToUse = pendingAudioUrl;

      // Recombine segments if any were regenerated
      if (segmentsNeedRecombine) {
        updateStep("recombine", "active");
        console.log("Recombining audio segments...");

        const recombineResult = await recombineAudioSegments(projectId, pendingAudioSegments.length);

        if (!recombineResult.success || !recombineResult.audioUrl) {
          throw new Error(recombineResult.error || "Failed to recombine audio segments");
        }

        audioUrlToUse = recombineResult.audioUrl;
        setPendingAudioUrl(audioUrlToUse);
        if (recombineResult.duration) setPendingAudioDuration(recombineResult.duration);
        if (recombineResult.size) setPendingAudioSize(recombineResult.size);
        setSegmentsNeedRecombine(false);

        updateStep("recombine", "completed");
        console.log(`Recombined audio: ${audioUrlToUse}`);
      }

      // Generate captions automatically (for accurate image timing)
      updateStep("captions", "active", "Transcribing audio...");
      console.log("Generating captions for image timing...");

      const captionsResult = await generateCaptions(
        audioUrlToUse,
        projectId,
        (progress, message) => {
          updateStep("captions", "active", message || `Transcribing... ${progress}%`);
        }
      );

      if (!captionsResult.success || !captionsResult.srtContent) {
        // Fall back to evenly distributed timing if captions fail
        console.warn("Captions generation failed, using even distribution:", captionsResult.error);
        updateStep("captions", "completed", "Using even distribution");
        await handleSkipCaptions();
        return;
      }

      updateStep("captions", "completed", "Transcription complete");
      console.log("Captions generated successfully");

      // Use the real SRT for image timing
      setPendingSrtContent(captionsResult.srtContent);
      autoSave("captions", { srtContent: captionsResult.srtContent });

      // Continue to image prompts with accurate timing
      await handleCaptionsConfirm(captionsResult.srtContent);

    } catch (error) {
      console.error("Audio confirm error:", error);
      toast({
        title: "Audio Processing Failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  // Step 4: After captions confirmed, generate image prompts for review
  const handleCaptionsConfirm = async (srt: string) => {
    setPendingSrtContent(srt);

    // Auto-save captions immediately
    autoSave("captions", { srtContent: srt });

    const steps: GenerationStep[] = [
      { id: "prompts", label: "Generating Scene Descriptions", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      updateStep("prompts", "active", "Analyzing script...");

      // Use confirmedScript if available, otherwise extract text from captions
      // This handles the "Generate Captions" flow where user uploads audio without a script
      let scriptForPrompts = confirmedScript;
      if (!scriptForPrompts.trim()) {
        // Extract plain text from SRT captions
        const srtLines = srt.split('\n');
        const textLines: string[] = [];
        for (let i = 0; i < srtLines.length; i++) {
          const line = srtLines[i].trim();
          // Skip empty lines, numbers, and timecodes
          if (line && !line.match(/^\d+$/) && !line.includes('-->')) {
            textLines.push(line);
          }
        }
        scriptForPrompts = textLines.join(' ');
        console.log('No script available, using captions text for image prompts');
      }

      const promptResult = await generateImagePrompts(
        scriptForPrompts,
        srt,
        settings.imageCount,
        getSelectedImageStyle(),
        pendingAudioDuration,
        (progress, message) => {
          updateStep("prompts", "active", message);
        }
      );

      if (!promptResult.success || !promptResult.prompts) {
        throw new Error(promptResult.error || "Failed to generate image prompts");
      }

      console.log(`Generated ${promptResult.prompts.length} AI-powered image prompts with timing`);
      setImagePrompts(promptResult.prompts);
      updateStep("prompts", "completed", `${promptResult.prompts.length} scenes`);

      // Auto-save after image prompts generation
      autoSave("prompts", { imagePrompts: promptResult.prompts });

      await new Promise(resolve => setTimeout(resolve, 300));
      setViewState("review-prompts");

    } catch (error) {
      console.error("Image prompt generation error:", error);
      toast({
        title: "Prompt Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        variant: "destructive",
      });
      setViewState("create");
    }
  };

  // Step 5: After prompts reviewed/edited, generate images
  const handlePromptsConfirm = async (editedPrompts: ImagePromptWithTiming[], editedStylePrompt: string) => {
    setImagePrompts(editedPrompts);
    // editedStylePrompt is used directly for this generation (not saved back to template)

    const steps: GenerationStep[] = [
      { id: "images", label: "Generating Images", status: "pending" },
    ];

    setProcessingSteps(steps);
    setViewState("processing");

    try {
      updateStep("images", "active", `0/${editedPrompts.length}`);

      const imageResult = await generateImagesStreaming(
        editedPrompts,
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

      // Auto-save after images generation
      autoSave("images", { imageUrls: imageResult.images || [] });

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

  // Regenerate a single image (optionally with edited prompt)
  const handleRegenerateImage = async (index: number, editedSceneDescription?: string) => {
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
      // If edited prompt provided, update the imagePrompts state first
      let promptToUse = imagePrompts[index];
      if (editedSceneDescription) {
        promptToUse = {
          ...imagePrompts[index],
          sceneDescription: editedSceneDescription,
          prompt: imagePrompts[index].prompt.replace(imagePrompts[index].sceneDescription, editedSceneDescription)
        };
        // Update the prompts state with the edited version
        setImagePrompts(prev => {
          const newPrompts = [...prev];
          newPrompts[index] = promptToUse;
          return newPrompts;
        });
      }

      console.log(`Regenerating image ${index + 1}${editedSceneDescription ? ' with edited prompt' : ''}...`);

      const imageResult = await generateImagesStreaming(
        [promptToUse], // Regenerate just this one prompt with timing
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
  const handleImagesConfirmWithImages = (images: string[]) => {
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

    images.forEach((imageUrl, index) => {
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

    // Add to project history and clear in-progress save
    addToProjectHistory({
      id: projectId,
      videoTitle,
      completedAt: Date.now(),
      imageCount: images.length,
      audioDuration: pendingAudioDuration,
      script: confirmedScript,
      audioUrl: pendingAudioUrl,
      srtContent: pendingSrtContent,
      srtUrl: pendingSrtUrl,
      imageUrls: images,
      imagePrompts: imagePrompts,
    });
    clearProject();

    toast({
      title: "Generation Complete!",
      description: "Your history video assets are ready.",
    });
  };

  const handleImagesConfirm = () => {
    // Go to thumbnail generation step
    setViewState("review-thumbnails");
  };

  // Thumbnail handlers
  const handleThumbnailsConfirm = (thumbnails: string[]) => {
    setGeneratedThumbnails(thumbnails);
    // Go to video render step
    setViewState("review-render");
  };

  const handleThumbnailsSkip = () => {
    setGeneratedThumbnails([]);
    // Go to video render step
    setViewState("review-render");
  };

  // Video render handlers
  const handleRenderConfirm = (videoUrl: string) => {
    setRenderedVideoUrl(videoUrl);
    // Go to YouTube upload step
    setViewState("review-youtube");
  };

  const handleRenderSkip = () => {
    setRenderedVideoUrl(undefined);
    // Skip to YouTube (can still upload if they rendered before)
    setViewState("review-youtube");
  };

  const handleBackToThumbnails = () => {
    setViewState("review-thumbnails");
  };

  // YouTube upload handlers
  const handleYouTubeComplete = () => {
    // Go to results
    handleImagesConfirmWithImages(pendingImages);
  };

  const handleYouTubeSkip = () => {
    // Go to results
    handleImagesConfirmWithImages(pendingImages);
  };

  const handleBackToRender = () => {
    setViewState("review-render");
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
    setGeneratedThumbnails([]);
    setRenderedVideoUrl(undefined);
    setVideoUrl(undefined);
    setVideoUrlCaptioned(undefined);
    setEmbersVideoUrl(undefined);
    setSmokeEmbersVideoUrl(undefined);
    setImagePrompts([]);
  };

  const handleCancelRequest = () => {
    setShowExitConfirmation(true);
  };

  const handleConfirmExit = () => {
    setShowExitConfirmation(false);
    resetPendingState();
    setViewState("create");
    toast({
      title: "Project Closed",
      description: "Your progress has been cleared.",
    });
  };

  const handleCancelExit = () => {
    setShowExitConfirmation(false);
  };

  // Back navigation handlers
  const handleBackToCreate = () => {
    setViewState("create");
  };

  const handleBackToScript = () => {
    setViewState("review-script");
  };

  const handleBackToAudio = () => {
    setViewState("review-audio");
  };

  const handleBackToPrompts = () => {
    setViewState("review-prompts");
  };

  const handleBackToImages = () => {
    setViewState("review-images");
  };

  // Forward navigation handlers (to skip ahead if data already exists)
  const handleForwardToAudio = () => {
    if (pendingAudioUrl || pendingAudioSegments.length > 0) {
      setViewState("review-audio");
    }
  };

  const handleForwardToPrompts = () => {
    if (imagePrompts.length > 0) {
      setViewState("review-prompts");
    }
  };

  const handleForwardToImages = () => {
    if (pendingImages.length > 0) {
      setViewState("review-images");
    }
  };

  // Check if forward navigation is available for each step
  const canGoForwardFromScript = () => pendingAudioUrl || pendingAudioSegments.length > 0;
  const canGoForwardFromAudio = () => imagePrompts.length > 0;
  const canGoForwardFromPrompts = () => pendingImages.length > 0;

  // Handle audio file upload for "Generate Captions" mode
  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedAudioFile(file);
    }
  };

  // Handle script file upload for "Generate Images" mode
  const handleScriptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      setUploadedScript(text);
    }
  };

  // Handle captions file upload for "Generate Images" mode
  const handleCaptionsFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      setUploadedCaptions(text);
    }
  };

  // Handle audio file upload for "Generate Images" mode
  const handleAudioFileChangeForImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedAudioFileForImages(file);
    }
  };

  // Generate captions from uploaded audio file
  const handleGenerateCaptionsFromAudio = async () => {
    if (!uploadedAudioFile) {
      toast({ title: "No audio file", description: "Please upload an audio file first.", variant: "destructive" });
      return;
    }

    // Set project title
    const title = captionsProjectTitle.trim() || "Untitled Project";
    setVideoTitle(title);

    setViewState("processing");
    setProcessingSteps([{ id: "upload", label: "Uploading audio", status: "active", sublabel: "0%" }]);

    try {
      // Upload the audio file to Supabase storage with progress tracking
      const newProjectId = crypto.randomUUID();
      setProjectId(newProjectId);
      const audioFileName = `${newProjectId}/voiceover.wav`;

      // Use XMLHttpRequest for upload progress
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/generated-assets/${audioFileName}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        xhr.setRequestHeader('Authorization', `Bearer ${supabaseKey}`);
        xhr.setRequestHeader('apikey', supabaseKey);
        xhr.setRequestHeader('x-upsert', 'true');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setProcessingSteps([{ id: "upload", label: "Uploading audio", status: "active", sublabel: `${percent}%` }]);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(uploadedAudioFile);
      });

      const { data: { publicUrl } } = supabase.storage
        .from("generated-assets")
        .getPublicUrl(audioFileName);

      setPendingAudioUrl(publicUrl);

      // Update to show captions step
      setProcessingSteps([
        { id: "upload", label: "Uploading audio", status: "completed" },
        { id: "captions", label: "Generating captions", status: "active", sublabel: "5%" }
      ]);

      // Generate captions
      const captionsResult = await generateCaptions(
        publicUrl,
        newProjectId,
        (progress, message) => {
          const sublabel = message || `${progress}%`;
          setProcessingSteps([
            { id: "upload", label: "Uploading audio", status: "completed" },
            { id: "captions", label: "Generating captions", status: "active", sublabel }
          ]);
        }
      );

      if (!captionsResult.srtContent) throw new Error("No captions generated");

      setPendingSrtContent(captionsResult.srtContent);
      if (captionsResult.srtUrl) setPendingSrtUrl(captionsResult.srtUrl);
      if (captionsResult.audioDuration) setPendingAudioDuration(captionsResult.audioDuration);

      // Auto-save after captions generation
      autoSave("captions", {
        id: newProjectId,
        videoTitle: title,
        audioUrl: publicUrl,
        audioDuration: captionsResult.audioDuration,
        srtContent: captionsResult.srtContent,
        srtUrl: captionsResult.captionsUrl || "",
      });

      setProcessingSteps([
        { id: "upload", label: "Uploading audio", status: "completed" },
        { id: "captions", label: "Captions generated", status: "completed" }
      ]);
      setViewState("review-captions");

    } catch (error) {
      console.error("Error generating captions:", error);
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to generate captions", variant: "destructive" });
      setViewState("create");
    }
  };

  // Generate image prompts from uploaded script/captions
  const handleGenerateImagePrompts = async () => {
    const scriptText = uploadedScript.trim();
    const captionsText = uploadedCaptions.trim();

    console.log("Script length:", scriptText.length);
    console.log("Captions length:", captionsText.length);
    console.log("Image count:", settings.imageCount);
    console.log("Style prompt length:", getSelectedImageStyle().length);
    console.log("Audio file:", uploadedAudioFileForImages?.name);

    if (!scriptText) {
      toast({ title: "No script", description: "Please upload or paste a script first.", variant: "destructive" });
      return;
    }
    if (!captionsText) {
      toast({ title: "No captions", description: "Please upload or paste captions (SRT) first.", variant: "destructive" });
      return;
    }

    // Set project title
    const title = imagesProjectTitle.trim() || "Untitled Project";
    setVideoTitle(title);

    setViewState("processing");
    setProcessingSteps([{ id: "prompts", label: "Generating image prompts...", status: "loading", progress: 10 }]);
    setPendingScript(scriptText);
    setConfirmedScript(scriptText);
    setPendingSrtContent(captionsText);

    try {
      let audioDuration: number | undefined;

      // If audio file provided, upload it and get duration
      if (uploadedAudioFileForImages) {
        setProcessingSteps([{ id: "prompts", label: "Uploading audio file...", status: "loading", progress: 5 }]);

        const newProjectId = projectId || crypto.randomUUID();
        if (!projectId) setProjectId(newProjectId);

        const audioFileName = `${newProjectId}/voiceover.wav`;
        const { error: uploadError } = await supabase.storage
          .from("generated-assets")
          .upload(audioFileName, uploadedAudioFileForImages);

        if (uploadError) {
          console.error("Audio upload error:", uploadError);
          // Continue without audio duration if upload fails
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from("generated-assets")
            .getPublicUrl(audioFileName);

          setPendingAudioUrl(publicUrl);

          // Get audio duration using Audio element
          audioDuration = await new Promise<number>((resolve) => {
            const audio = new Audio(publicUrl);
            audio.addEventListener('loadedmetadata', () => {
              resolve(audio.duration);
            });
            audio.addEventListener('error', () => {
              console.error("Failed to get audio duration");
              resolve(0);
            });
          });

          if (audioDuration > 0) {
            setPendingAudioDuration(audioDuration);
            console.log("Audio duration:", audioDuration);
          }
        }

        setProcessingSteps([{ id: "prompts", label: "Generating image prompts...", status: "loading", progress: 10 }]);
      }

      const promptsResult = await generateImagePrompts(
        scriptText,
        captionsText,
        settings.imageCount,
        getSelectedImageStyle(),
        audioDuration
      );

      if (!promptsResult.success) {
        throw new Error(promptsResult.error || "Failed to generate image prompts");
      }

      if (!promptsResult.prompts || promptsResult.prompts.length === 0) {
        throw new Error("No image prompts generated");
      }

      setImagePrompts(promptsResult.prompts);

      // Auto-save after image prompts generation
      const newProjectId = projectId || crypto.randomUUID();
      if (!projectId) setProjectId(newProjectId);

      autoSave("prompts", {
        id: newProjectId,
        videoTitle: title,
        script: scriptText,
        srtContent: captionsText,
        audioUrl: pendingAudioUrl,
        audioDuration: audioDuration || pendingAudioDuration,
        imagePrompts: promptsResult.prompts,
      });

      setProcessingSteps([{ id: "prompts", label: "Image prompts generated", status: "complete", progress: 100 }]);
      setViewState("review-prompts");

    } catch (error) {
      console.error("Error generating image prompts:", error);
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to generate image prompts", variant: "destructive" });
      setViewState("create");
    }
  };

  const handleNewProject = () => {
    setViewState("create");
    setInputValue("");
    setSourceUrl("");
    resetPendingState();
    clearProject();
  };

  // Open a project from history
  const handleOpenProject = (project: ProjectHistoryItem) => {
    // Set project state
    setProjectId(project.id);
    setVideoTitle(project.videoTitle);
    setSourceUrl(project.videoTitle);

    // Set asset state for ALL views (so back navigation works)
    if (project.script) {
      setPendingScript(project.script);
      setConfirmedScript(project.script);
    }
    if (project.audioUrl) {
      setPendingAudioUrl(project.audioUrl);
      setAudioUrl(project.audioUrl);
    }
    if (project.audioDuration) setPendingAudioDuration(project.audioDuration);
    if (project.srtContent) {
      setPendingSrtContent(project.srtContent);
      setSrtContent(project.srtContent);
    }
    if (project.srtUrl) setPendingSrtUrl(project.srtUrl);
    if (project.imageUrls) {
      setPendingImages(project.imageUrls);
    }
    // Use stored image prompts if available, otherwise create basic ones
    if (project.imagePrompts && project.imagePrompts.length > 0) {
      setImagePrompts(project.imagePrompts);
    } else if (project.imageUrls) {
      const basicPrompts: ImagePromptWithTiming[] = project.imageUrls.map((url, index) => ({
        index: index + 1,
        startTime: "",
        endTime: "",
        startSeconds: 0,
        endSeconds: 0,
        prompt: "",
        sceneDescription: `Image ${index + 1}`,
      }));
      setImagePrompts(basicPrompts);
    }
    // Load video URLs if available
    if (project.videoUrl) {
      setVideoUrl(project.videoUrl);
    }
    if (project.videoUrlCaptioned) {
      setVideoUrlCaptioned(project.videoUrlCaptioned);
    }
    if (project.embersVideoUrl) {
      setEmbersVideoUrl(project.embersVideoUrl);
    }
    if (project.smokeEmbersVideoUrl) {
      setSmokeEmbersVideoUrl(project.smokeEmbersVideoUrl);
    }

    // Build generated assets for results view
    const assets: GeneratedAsset[] = [];
    if (project.script) {
      assets.push({
        id: "script",
        name: "Rewritten Script",
        type: "Markdown",
        size: `${Math.round(project.script.length / 1024)} KB`,
        icon: <FileText className="w-5 h-5 text-muted-foreground" />,
        content: project.script,
      });
    }
    if (project.audioUrl) {
      assets.push({
        id: "audio",
        name: "Voiceover Audio",
        type: "MP3",
        size: project.audioDuration ? `${Math.round(project.audioDuration / 60)} min` : "Unknown",
        icon: <Mic className="w-5 h-5 text-muted-foreground" />,
        url: project.audioUrl,
      });
    }
    if (project.srtContent) {
      assets.push({
        id: "captions",
        name: "Captions",
        type: "SRT",
        size: `${Math.round(project.srtContent.length / 1024)} KB`,
        icon: <FileText className="w-5 h-5 text-muted-foreground" />,
        url: project.srtUrl,
        content: project.srtContent,
      });
    }
    if (project.imageUrls) {
      project.imageUrls.forEach((imageUrl, index) => {
        assets.push({
          id: `image-${index + 1}`,
          name: `Image ${index + 1}`,
          type: "PNG",
          size: "~1 MB",
          icon: <Image className="w-5 h-5 text-muted-foreground" />,
          url: imageUrl,
        });
      });
    }
    setGeneratedAssets(assets);

    // Go to results page (last step with all downloads)
    setViewState("results");

    toast({
      title: "Project Opened",
      description: `Loaded "${project.videoTitle}"`,
    });
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
          
          <div className="flex items-center gap-2">
            <ProjectsDrawer onOpenProject={handleOpenProject} />
            <ConfigModal
              scriptTemplates={scriptTemplates}
              onSaveScriptTemplates={handleSaveScriptTemplates}
              imageTemplates={imageTemplates}
              onSaveImageTemplates={handleSaveImageTemplates}
              cartesiaVoices={cartesiaVoices}
              onSaveVoices={handleSaveVoices}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      {viewState === "results" ? (
        <ProjectResults
          sourceUrl={sourceUrl}
          onNewProject={handleNewProject}
          onBack={handleBackToThumbnails}
          assets={generatedAssets}
          srtContent={srtContent}
          imagePrompts={imagePrompts}
          audioUrl={audioUrl}
          audioDuration={pendingAudioDuration}
          projectTitle={videoTitle}
          projectId={projectId}
          videoUrl={videoUrl}
          videoUrlCaptioned={videoUrlCaptioned}
          embersVideoUrl={embersVideoUrl}
          smokeEmbersVideoUrl={smokeEmbersVideoUrl}
          onVideoRendered={(url) => {
            setVideoUrl(url);
            // Save to current project and update history
            autoSave("complete", { videoUrl: url });
            updateProjectInHistory(projectId, { videoUrl: url });
          }}
          onCaptionedVideoRendered={(url) => {
            setVideoUrlCaptioned(url);
            // Save captioned video URL to current project and update history
            autoSave("complete", { videoUrlCaptioned: url });
            updateProjectInHistory(projectId, { videoUrlCaptioned: url });
          }}
          onEmbersVideoRendered={(url) => {
            setEmbersVideoUrl(url);
            // Save embers video URL to current project and update history
            autoSave("complete", { embersVideoUrl: url });
            updateProjectInHistory(projectId, { embersVideoUrl: url });
          }}
          onSmokeEmbersVideoRendered={(url) => {
            setSmokeEmbersVideoUrl(url);
            // Save smoke+embers video URL to current project and update history
            autoSave("complete", { smokeEmbersVideoUrl: url });
            updateProjectInHistory(projectId, { smokeEmbersVideoUrl: url });
          }}
          autoRender={settings.fullAutomation}
          thumbnails={generatedThumbnails}
        />
      ) : (
        <main className="flex flex-col items-center justify-center px-4 py-32">
          {/* Resume saved project banner */}
          {savedProject && viewState === "create" && (
            <div className="w-full max-w-3xl mx-auto mb-8">
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RotateCcw className="w-5 h-5 text-primary" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground">
                      Resume previous project?
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {savedProject.videoTitle} - {getStepLabel(savedProject.step)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismissSavedProject}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleResumeProject}
                  >
                    Resume
                  </Button>
                </div>
              </div>
            </div>
          )}

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

            {/* Two entry mode buttons */}
            <div className="flex gap-3 justify-center mb-2">
              <Button
                variant={entryMode === "script" ? "default" : "outline"}
                onClick={() => setEntryMode("script")}
                className="flex-1 max-w-[200px] py-6"
              >
                <FileText className="w-4 h-4 mr-2" />
                Generate Script
              </Button>
              <Button
                variant={entryMode === "images" ? "default" : "outline"}
                onClick={() => setEntryMode("images")}
                className="flex-1 max-w-[200px] py-6"
              >
                <Image className="w-4 h-4 mr-2" />
                Generate Images
              </Button>
            </div>

            {/* Content based on entry mode */}
            {entryMode === "script" && (
              <>
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
                        imageTemplates={imageTemplates}
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
                      imageTemplates={imageTemplates}
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
              </>
            )}

            {entryMode === "images" && (
              <div className="bg-card rounded-2xl shadow-sm border border-border p-6 space-y-4">
                <p className="text-muted-foreground text-sm">
                  Upload or paste your script and captions (SRT) to generate image prompts.
                </p>

                {/* Project Title input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-left block">Project Title</label>
                  <Input
                    value={imagesProjectTitle}
                    onChange={(e) => setImagesProjectTitle(e.target.value)}
                    placeholder="Enter project title..."
                    className="w-full"
                  />
                </div>

                {/* Script input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-left block">Script</label>
                  <input
                    ref={scriptFileInputRef}
                    type="file"
                    accept=".txt,.md"
                    onChange={handleScriptFileChange}
                    className="hidden"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scriptFileInputRef.current?.click()}
                    >
                      Upload .txt
                    </Button>
                    <span className="text-xs text-muted-foreground self-center">or paste below</span>
                  </div>
                  <textarea
                    value={uploadedScript}
                    onChange={(e) => setUploadedScript(e.target.value)}
                    placeholder="Paste your script here..."
                    className="w-full h-32 p-3 text-sm border rounded-lg resize-none bg-background"
                  />
                </div>

                {/* Captions input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-left block">Captions (SRT)</label>
                  <input
                    ref={captionsFileInputRef}
                    type="file"
                    accept=".srt,.txt"
                    onChange={handleCaptionsFileChange}
                    className="hidden"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => captionsFileInputRef.current?.click()}
                    >
                      Upload .srt
                    </Button>
                    <span className="text-xs text-muted-foreground self-center">or paste below</span>
                  </div>
                  <textarea
                    value={uploadedCaptions}
                    onChange={(e) => setUploadedCaptions(e.target.value)}
                    placeholder="Paste your SRT captions here..."
                    className="w-full h-32 p-3 text-sm border rounded-lg resize-none bg-background font-mono"
                  />
                </div>

                {/* Audio file input (optional) */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-left block">
                    Audio File <span className="text-muted-foreground font-normal">(optional - for accurate timing)</span>
                  </label>
                  <input
                    ref={audioFileInputImagesRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileChangeForImages}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => audioFileInputImagesRef.current?.click()}
                    className="w-full justify-start"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    {uploadedAudioFileForImages ? uploadedAudioFileForImages.name : "Choose Audio File"}
                  </Button>
                </div>

                <Button
                  onClick={handleGenerateImagePrompts}
                  disabled={!uploadedScript.trim() || !uploadedCaptions.trim() || viewState !== "create"}
                  className="w-full"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Image Prompts
                </Button>
              </div>
            )}

          </div>
        </main>
      )}

      {/* Processing Modal */}
      <ProcessingModal
        isOpen={viewState === "processing"}
        onClose={handleCancelRequest}
        steps={processingSteps}
      />

      {/* Script Review Modal */}
      <ScriptReviewModal
        isOpen={viewState === "review-script"}
        script={pendingScript}
        onConfirm={handleScriptConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToCreate}
        onForward={canGoForwardFromScript() ? handleForwardToAudio : undefined}
      />

      {/* Audio Preview Modal - Show segments modal if we have segments, otherwise legacy single audio */}
      {pendingAudioSegments.length > 0 ? (
        <AudioSegmentsPreviewModal
          isOpen={viewState === "review-audio"}
          segments={pendingAudioSegments}
          combinedAudioUrl={pendingAudioUrl}
          totalDuration={pendingAudioDuration}
          onConfirmAll={handleAudioConfirm}
          onRegenerate={handleSegmentRegenerate}
          onCancel={handleCancelRequest}
          onBack={handleBackToScript}
          onForward={canGoForwardFromAudio() ? handleForwardToPrompts : undefined}
          regeneratingIndex={regeneratingSegmentIndex}
        />
      ) : (
        <AudioPreviewModal
          isOpen={viewState === "review-audio"}
          audioUrl={pendingAudioUrl}
          duration={pendingAudioDuration}
          onConfirm={handleAudioConfirm}
          onRegenerate={handleAudioRegenerate}
          onCancel={handleCancelRequest}
          onBack={handleBackToScript}
        />
      )}

      {/* Image Prompts Preview Modal */}
      <ImagePromptsPreviewModal
        isOpen={viewState === "review-prompts"}
        prompts={imagePrompts}
        stylePrompt={getSelectedImageStyle()}
        onConfirm={handlePromptsConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToAudio}
        onForward={canGoForwardFromPrompts() ? handleForwardToImages : undefined}
      />

      {/* Images Preview Modal */}
      <ImagesPreviewModal
        isOpen={viewState === "review-images"}
        images={pendingImages}
        prompts={imagePrompts}
        script={confirmedScript}
        onConfirm={handleImagesConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToPrompts}
        onForward={() => setViewState("review-thumbnails")}
        onRegenerate={handleRegenerateImage}
        regeneratingIndex={regeneratingImageIndex}
      />

      {/* Thumbnail Generator Modal */}
      <ThumbnailGeneratorModal
        isOpen={viewState === "review-thumbnails"}
        projectId={projectId}
        projectTitle={videoTitle}
        script={confirmedScript}
        onConfirm={handleThumbnailsConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToImages}
        onSkip={handleThumbnailsSkip}
      />

      {/* Video Render Modal (Smoke + Embers) */}
      <VideoRenderModal
        isOpen={viewState === "review-render"}
        projectId={projectId}
        projectTitle={videoTitle}
        audioUrl={pendingAudioUrl}
        imageUrls={pendingImages}
        imageTimings={imagePrompts.map(p => ({ startSeconds: p.startSeconds, endSeconds: p.endSeconds }))}
        srtContent={pendingSrtContent}
        onConfirm={handleRenderConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToThumbnails}
        onSkip={handleRenderSkip}
      />

      {/* YouTube Upload Modal */}
      <YouTubeUploadModal
        isOpen={viewState === "review-youtube"}
        videoUrl={renderedVideoUrl || ""}
        projectTitle={videoTitle}
        thumbnails={generatedThumbnails}
        onClose={handleYouTubeComplete}
        onSuccess={handleYouTubeComplete}
        onBack={handleBackToRender}
        onSkip={handleYouTubeSkip}
      />

      {/* Exit Confirmation Dialog */}
      <AlertDialog open={showExitConfirmation} onOpenChange={setShowExitConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit Project?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to exit? All your progress in this project will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelExit}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExit}>Exit Project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Index;
