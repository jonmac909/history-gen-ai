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
import { ConfigModal, type ScriptTemplate, type CartesiaVoice } from "@/components/ConfigModal";
import { ProjectResults, type GeneratedAsset } from "@/components/ProjectResults";
import { ScriptReviewModal } from "@/components/ScriptReviewModal";
import { AudioPreviewModal } from "@/components/AudioPreviewModal";
import { AudioSegmentsPreviewModal } from "@/components/AudioSegmentsPreviewModal";
import { CaptionsPreviewModal } from "@/components/CaptionsPreviewModal";
import { ImagesPreviewModal } from "@/components/ImagesPreviewModal";
import { ImagePromptsPreviewModal } from "@/components/ImagePromptsPreviewModal";
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
import { supabase } from "@/integrations/supabase/client";
import { saveProject, loadProject, clearProject, getStepLabel, addToProjectHistory, type SavedProject, type ProjectHistoryItem } from "@/lib/projectPersistence";
import { ProjectsDrawer } from "@/components/ProjectsDrawer";

type InputMode = "url" | "title";
type ViewState = "create" | "processing" | "review-script" | "review-audio" | "review-captions" | "review-prompts" | "review-images" | "results";
type EntryMode = "script" | "captions" | "images";

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [viewState, setViewState] = useState<ViewState>("create");
  const [settings, setSettings] = useState<GenerationSettings>({
    projectTitle: "",
    scriptTemplate: "template-a",
    aiModel: "claude-sonnet-4-5",
    voiceSampleUrl: "https://historygenai.netlify.app/voices/clone_voice.mp3",
    speed: 1,
    imageCount: 10,
    wordCount: 1000,
    quality: "basic",
  });
  const [processingSteps, setProcessingSteps] = useState<GenerationStep[]>([]);
  const [scriptTemplates, setScriptTemplates] = useState<ScriptTemplate[]>(defaultTemplates);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoice[]>([]);
  const [imageStylePrompt, setImageStylePrompt] = useState("Warm classical oil-painting style, inspired by Dutch Golden Age.. Soft, intimate chiaroscuro with lifted shadows and glowing midtones, avoiding harsh contrast. Rich, earthy palette of warm reds, ochres, umbers, and deep teal-blues. Painterly brushwork with visible texture and gentle edges. Quiet, reverent, contemplative mood. Old-world, timeless atmosphere with a sense of stillness, intimacy, and human warmth. Romantic historical painting sensibility with softened realism. Gentle, peaceful tone — not scary, not violent. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation");
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

  // Check for saved project on load and when returning to create view
  useEffect(() => {
    if (viewState === "create") {
      const saved = loadProject();
      if (saved) {
        setSavedProject(saved);
      }
    }
  }, [viewState]);

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
    };
    saveProject(project);
    console.log(`Auto-saved project at step: ${step}`);
  };

  // Resume saved project
  const handleResumeProject = () => {
    if (!savedProject) return;

    // Restore state from saved project
    setProjectId(savedProject.id);
    setSourceUrl(savedProject.sourceUrl);
    setVideoTitle(savedProject.videoTitle);
    setSettings(savedProject.settings);

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

    // Navigate to the appropriate view based on saved step
    switch (savedProject.step) {
      case "script":
        setViewState("review-script");
        break;
      case "audio":
        setViewState("review-audio");
        break;
      case "captions":
        setViewState("review-captions");
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
        settings.speed
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

      // Auto-save after captions generation
      autoSave("captions", {
        srtContent: captionsRes.srtContent,
        srtUrl: captionsRes.captionsUrl || "",
      });

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

  // Step 4: After captions confirmed, generate image prompts for review
  const handleCaptionsConfirm = async (srt: string) => {
    setPendingSrtContent(srt);

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
        imageStylePrompt,
        pendingAudioDuration
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
    // Save the edited style prompt for future use
    if (editedStylePrompt !== imageStylePrompt) {
      setImageStylePrompt(editedStylePrompt);
    }

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
    handleImagesConfirmWithImages(pendingImages);
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

  const handleBackToCaptions = () => {
    setViewState("review-captions");
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

  const handleForwardToCaptions = () => {
    if (pendingSrtContent) {
      setViewState("review-captions");
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
  const canGoForwardFromAudio = () => !!pendingSrtContent;
  const canGoForwardFromCaptions = () => imagePrompts.length > 0;
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

    setViewState("processing");
    setProcessingSteps([{ id: "captions", label: "Generating captions...", status: "loading", progress: 5 }]);

    try {
      // Upload the audio file to Supabase storage
      const projectId = crypto.randomUUID();
      const audioFileName = `${projectId}/voiceover.wav`;

      const { error: uploadError } = await supabase.storage
        .from("generated-assets")
        .upload(audioFileName, uploadedAudioFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("generated-assets")
        .getPublicUrl(audioFileName);

      setPendingAudioUrl(publicUrl);

      // Generate captions
      const captionsResult = await generateCaptions(
        publicUrl,
        (progress) => {
          setProcessingSteps([{ id: "captions", label: "Generating captions...", status: "loading", progress }]);
        }
      );

      if (!captionsResult.srtContent) throw new Error("No captions generated");

      setPendingSrtContent(captionsResult.srtContent);
      if (captionsResult.srtUrl) setPendingSrtUrl(captionsResult.srtUrl);

      setProcessingSteps([{ id: "captions", label: "Captions generated", status: "complete", progress: 100 }]);
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
    console.log("Style prompt length:", imageStylePrompt.length);
    console.log("Audio file:", uploadedAudioFileForImages?.name);

    if (!scriptText) {
      toast({ title: "No script", description: "Please upload or paste a script first.", variant: "destructive" });
      return;
    }
    if (!captionsText) {
      toast({ title: "No captions", description: "Please upload or paste captions (SRT) first.", variant: "destructive" });
      return;
    }

    setViewState("processing");
    setProcessingSteps([{ id: "prompts", label: "Generating image prompts...", status: "loading", progress: 10 }]);
    setPendingScript(scriptText);
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
        imageStylePrompt,
        audioDuration
      );

      if (!promptsResult.success) {
        throw new Error(promptsResult.error || "Failed to generate image prompts");
      }

      if (!promptsResult.prompts || promptsResult.prompts.length === 0) {
        throw new Error("No image prompts generated");
      }

      setImagePrompts(promptsResult.prompts);
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
              onSaveTemplates={handleSaveTemplates}
              cartesiaVoices={cartesiaVoices}
              onSaveVoices={handleSaveVoices}
              imageStylePrompt={imageStylePrompt}
              onSaveImageStylePrompt={handleSaveImageStylePrompt}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      {viewState === "results" ? (
        <ProjectResults
          sourceUrl={sourceUrl}
          onNewProject={handleNewProject}
          onBack={handleBackToImages}
          assets={generatedAssets}
          srtContent={srtContent}
          imagePrompts={imagePrompts}
          audioUrl={audioUrl}
          audioDuration={pendingAudioDuration}
          projectTitle={videoTitle}
          projectId={projectId}
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

            {/* Three entry mode buttons */}
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
                variant={entryMode === "captions" ? "default" : "outline"}
                onClick={() => setEntryMode("captions")}
                className="flex-1 max-w-[200px] py-6"
              >
                <Mic className="w-4 h-4 mr-2" />
                Generate Captions
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
              </>
            )}

            {entryMode === "captions" && (
              <div className="bg-card rounded-2xl shadow-sm border border-border p-6 space-y-4">
                <p className="text-muted-foreground text-sm">
                  Upload an audio file to generate captions (SRT) from it.
                </p>
                <input
                  ref={audioFileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileChange}
                  className="hidden"
                />
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    onClick={() => audioFileInputRef.current?.click()}
                    className="flex-1"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    {uploadedAudioFile ? uploadedAudioFile.name : "Choose Audio File"}
                  </Button>
                  <Button
                    onClick={handleGenerateCaptionsFromAudio}
                    disabled={!uploadedAudioFile || viewState !== "create"}
                    className="shrink-0"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Captions
                  </Button>
                </div>
              </div>
            )}

            {entryMode === "images" && (
              <div className="bg-card rounded-2xl shadow-sm border border-border p-6 space-y-4">
                <p className="text-muted-foreground text-sm">
                  Upload or paste your script and captions (SRT) to generate image prompts.
                </p>

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
          onForward={canGoForwardFromAudio() ? handleForwardToCaptions : undefined}
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
          onForward={canGoForwardFromAudio() ? handleForwardToCaptions : undefined}
        />
      )}

      {/* Captions Preview Modal */}
      <CaptionsPreviewModal
        isOpen={viewState === "review-captions"}
        srtContent={pendingSrtContent}
        onConfirm={handleCaptionsConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToAudio}
        onForward={canGoForwardFromCaptions() ? handleForwardToPrompts : undefined}
      />

      {/* Image Prompts Preview Modal */}
      <ImagePromptsPreviewModal
        isOpen={viewState === "review-prompts"}
        prompts={imagePrompts}
        stylePrompt={imageStylePrompt}
        onConfirm={handlePromptsConfirm}
        onCancel={handleCancelRequest}
        onBack={handleBackToCaptions}
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
        onRegenerate={handleRegenerateImage}
        regeneratingIndex={regeneratingImageIndex}
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
