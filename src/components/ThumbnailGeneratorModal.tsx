import { useState, useRef, useEffect } from "react";
import { Image, Upload, X, Loader2, Download, Sparkles, ChevronLeft, ChevronRight, Check, ArrowUp, Expand, Heart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { generateThumbnailsStreaming, type ThumbnailGenerationProgress } from "@/lib/api";
import JSZip from "jszip";

interface ThumbnailGeneratorModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle?: string;
  script?: string;
  initialThumbnails?: string[];
  initialSelectedIndex?: number;
  favoriteThumbnails?: string[];
  onFavoriteToggle?: (url: string) => void;
  onConfirm: (thumbnails: string[], selectedIndex: number | undefined) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onForward?: () => void;  // Navigate to next step (YouTube)
}

export function ThumbnailGeneratorModal({
  isOpen,
  projectId,
  initialThumbnails,
  initialSelectedIndex,
  favoriteThumbnails = [],
  onFavoriteToggle,
  onConfirm,
  onCancel,
  onBack,
  onSkip,
  onForward,
}: ThumbnailGeneratorModalProps) {
  // Default reference thumbnail
  const DEFAULT_THUMBNAIL_URL = "/thumbs/boring.jpg";

  // Upload state
  const [exampleImage, setExampleImage] = useState<File | null>(null);
  const [examplePreview, setExamplePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load default thumbnail on mount or when project changes
  useEffect(() => {
    // Reset to default when project changes
    loadDefaultThumbnail();
  }, [projectId]);

  const loadDefaultThumbnail = async () => {
    setIsUploading(true);
    try {
      const response = await fetch(DEFAULT_THUMBNAIL_URL);
      const blob = await response.blob();
      const file = new File([blob], 'default-reference.jpg', { type: blob.type });
      setExampleImage(file);

      const reader = new FileReader();
      reader.onload = (e) => {
        setExamplePreview(e.target?.result as string);
        setIsUploading(false);
      };
      reader.onerror = () => setIsUploading(false);
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Failed to load default thumbnail:", error);
      setIsUploading(false);
    }
  };

  // Generation state - single prompt for everything
  const [imagePrompt, setImagePrompt] = useState("");
  const [thumbnailCount, setThumbnailCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ThumbnailGenerationProgress | null>(null);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>(initialThumbnails || []);

  // Selection state - which thumbnail is selected for YouTube upload
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(
    initialThumbnails && initialSelectedIndex !== undefined
      ? initialThumbnails[initialSelectedIndex] || null
      : null
  );

  // Reset state when modal opens with new initial values
  useEffect(() => {
    if (isOpen) {
      if (initialThumbnails && initialThumbnails.length > 0) {
        setGeneratedThumbnails(initialThumbnails);
        setSelectedThumbnail(
          initialSelectedIndex !== undefined
            ? initialThumbnails[initialSelectedIndex] || null
            : null
        );
      }
    }
  }, [isOpen, initialThumbnails, initialSelectedIndex]);

  // History stack for navigating back to previous thumbnail batches
  const [thumbnailHistory, setThumbnailHistory] = useState<{
    thumbnails: string[];
    referencePreview: string;
    prompt: string;
  }[]>([]);

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const lightboxOverlayRef = useRef<HTMLDivElement>(null);
  const lightboxImageRef = useRef<HTMLImageElement>(null);

  // Keyboard: ESC to close lightbox (capture phase to intercept before Dialog)
  useEffect(() => {
    if (!lightboxImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setLightboxImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [lightboxImage]);

  // Click handling: background click closes lightbox
  useEffect(() => {
    if (!lightboxImage) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;

      // If clicked on image, do nothing
      if (lightboxImageRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If clicked on overlay background, close
      if (lightboxOverlayRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        setLightboxImage(null);
      }
    };

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [lightboxImage]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a PNG, JPG, or WebP image.",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image under 20MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setExampleImage(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setExamplePreview(dataUrl);
      setIsUploading(false);
    };
    reader.onerror = () => {
      toast({
        title: "Upload Failed",
        description: "Failed to read image file.",
        variant: "destructive",
      });
      setIsUploading(false);
    };
    reader.readAsDataURL(file);

    // Clear previous results
    setGeneratedThumbnails([]);
  };

  const handleRemoveImage = () => {
    setExampleImage(null);
    setExamplePreview(null);
    setImagePrompt("");
    setGeneratedThumbnails([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!exampleImage || !examplePreview) {
      toast({
        title: "No Example Image",
        description: "Please upload an example thumbnail first.",
        variant: "destructive",
      });
      return;
    }

    if (!imagePrompt.trim()) {
      toast({
        title: "No Prompt",
        description: "Please wait for analysis or enter a prompt manually.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setProgress(null);
    setGeneratedThumbnails([]);
    setSelectedThumbnail(null);

    try {
      // Extract base64 from data URL - use indexOf instead of regex to avoid stack overflow on large strings
      const base64Prefix = ';base64,';
      const prefixIndex = examplePreview.indexOf(base64Prefix);
      if (prefixIndex === -1 || !examplePreview.startsWith('data:image/')) {
        throw new Error("Invalid image format");
      }
      const base64Data = examplePreview.substring(prefixIndex + base64Prefix.length);

      // Call the thumbnail generation API with the user's prompt
      const result = await generateThumbnailsStreaming(
        base64Data,
        imagePrompt,
        thumbnailCount,
        projectId,
        (progress) => setProgress(progress)
      );

      if (result.success && result.thumbnails) {
        setGeneratedThumbnails(result.thumbnails);
        toast({
          title: "Thumbnails Generated",
          description: `${result.thumbnails.length} thumbnails created successfully.`,
        });
      } else {
        toast({
          title: "Generation Failed",
          description: result.error || "Failed to generate thumbnails.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Thumbnail generation error:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate thumbnails.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  const handleDownloadThumbnail = async (url: string, index: number) => {
    const filename = `thumbnail_${index + 1}.png`;
    toast({
      title: "Downloading...",
      description: `Downloading ${filename}...`,
    });

    try {
      // Fetch the image as blob to bypass cross-origin download restrictions
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download thumbnail.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadAllAsZip = async () => {
    if (generatedThumbnails.length === 0) return;

    toast({
      title: "Preparing Download",
      description: `Creating zip with ${generatedThumbnails.length} thumbnails...`,
    });

    try {
      const zip = new JSZip();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      for (let i = 0; i < generatedThumbnails.length; i++) {
        const url = generatedThumbnails[i];
        const filename = `thumbnail_${i + 1}.png`;

        try {
          // Use edge function proxy to bypass CORS
          const response = await fetch(`${supabaseUrl}/functions/v1/download-images-zip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
            body: JSON.stringify({ imageUrl: url })
          });

          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
              zip.file(filename, blob);
            }
          }
        } catch (error) {
          console.error(`Error fetching thumbnail ${i + 1}:`, error);
        }
      }

      const fileCount = Object.keys(zip.files).length;
      if (fileCount === 0) {
        toast({
          title: "Download Failed",
          description: "Failed to fetch thumbnails.",
          variant: "destructive",
        });
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'thumbnails.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Download Complete",
        description: `thumbnails.zip downloaded with ${fileCount} images.`,
      });
    } catch (error) {
      console.error('Zip creation failed:', error);
      toast({
        title: "Download Failed",
        description: "Failed to create zip file.",
        variant: "destructive",
      });
    }
  };

  // Use a generated thumbnail as the new reference image
  const handleUseAsReference = async (url: string) => {
    setIsUploading(true);
    try {
      // Save current state to history before switching (if we have thumbnails)
      // Limit history to 5 entries to prevent memory issues with large base64 strings
      if (generatedThumbnails.length > 0 && examplePreview) {
        setThumbnailHistory(prev => {
          const newHistory = [...prev, {
            thumbnails: generatedThumbnails,
            referencePreview: examplePreview,
            prompt: imagePrompt,
          }];
          // Keep only the last 5 entries
          return newHistory.slice(-5);
        });
      }

      // Fetch the image and convert to data URL
      const response = await fetch(url);
      const blob = await response.blob();

      // Create a File object from the blob
      const file = new File([blob], 'reference.png', { type: blob.type });
      setExampleImage(file);

      // Convert to data URL for preview
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setExamplePreview(dataUrl);
        setIsUploading(false);
        toast({
          title: "Reference Updated",
          description: "Now using this thumbnail as the reference. Modify your prompt and generate again.",
        });
      };
      reader.onerror = () => {
        toast({
          title: "Failed",
          description: "Could not use this image as reference.",
          variant: "destructive",
        });
        setIsUploading(false);
      };
      reader.readAsDataURL(blob);

      // Clear generated thumbnails and selection to start fresh iteration
      setGeneratedThumbnails([]);
      setSelectedThumbnail(null);
    } catch (error) {
      console.error("Failed to use as reference:", error);
      toast({
        title: "Failed",
        description: "Could not fetch the image.",
        variant: "destructive",
      });
      setIsUploading(false);
    }
  };

  // Go back to previous thumbnail batch
  const handleGoBackInHistory = () => {
    if (thumbnailHistory.length === 0) return;

    const previousState = thumbnailHistory[thumbnailHistory.length - 1];

    // Restore previous state
    setGeneratedThumbnails(previousState.thumbnails);
    setExamplePreview(previousState.referencePreview);
    setImagePrompt(previousState.prompt);
    setSelectedThumbnail(null);

    // Remove from history
    setThumbnailHistory(prev => prev.slice(0, -1));

    toast({
      title: "Returned to Previous Batch",
      description: `Showing ${previousState.thumbnails.length} thumbnails from previous generation.`,
    });
  };

  const handleComplete = () => {
    // Pass all thumbnails and the selected index
    const selectedIndex = selectedThumbnail
      ? generatedThumbnails.indexOf(selectedThumbnail)
      : undefined;
    onConfirm(generatedThumbnails, selectedIndex !== -1 ? selectedIndex : undefined);
  };

  // Handle escape key - allow closing when not actively generating
  const handleEscapeKey = (e: KeyboardEvent) => {
    // If lightbox is open, let the lightbox handler deal with it
    if (lightboxImage) return;

    if (isGenerating || isUploading) {
      e.preventDefault();
    } else {
      onCancel();
    }
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-6xl max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={handleEscapeKey}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" />
            Generate Thumbnails
          </DialogTitle>
          <DialogDescription>
            Upload a reference thumbnail and describe what you want to generate
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex gap-6">
            {/* Left Column - Input Controls (narrower) */}
            <div className="w-64 shrink-0 space-y-4">
              {/* Upload Example Thumbnail */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Reference:</label>

                {examplePreview ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <img
                        src={examplePreview}
                        alt="Example thumbnail"
                        className="w-full h-auto rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                        style={{ aspectRatio: '16/9', objectFit: 'cover' }}
                        onClick={() => setLightboxImage(examplePreview)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 bg-background/80 hover:bg-background"
                        onClick={handleRemoveImage}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="w-3 h-3" />
                      Change Reference
                    </Button>
                  </div>
                ) : (
                  <div
                    className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-colors aspect-video flex items-center justify-center"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">Loading...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="w-5 h-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Upload reference
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Image Prompt */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Prompt:</label>
                <Textarea
                  placeholder="Describe style, colors, composition, mood, text..."
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="min-h-[80px] resize-y font-mono text-xs"
                />
              </div>

              {/* Thumbnail Count + Generate */}
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[3, 6, 9].map((count) => (
                    <Button
                      key={count}
                      variant={thumbnailCount === count ? "default" : "outline"}
                      size="sm"
                      onClick={() => setThumbnailCount(count)}
                      disabled={isGenerating}
                      className="h-7 w-7 px-0 text-xs"
                    >
                      {count}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={!examplePreview || !imagePrompt.trim() || isGenerating}
                  size="sm"
                  className="flex-1 gap-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Generate
                    </>
                  )}
                </Button>
              </div>

              {/* Progress */}
              {progress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {progress.message || (progress.stage === 'analyzing' ? 'Processing...' : 'Generating...')}
                    </span>
                    <span className="font-medium">{progress.percent}%</span>
                  </div>
                  <Progress value={progress.percent} className="h-1.5" />
                </div>
              )}
            </div>

            {/* Right Column - Generated Thumbnails (wider) */}
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Generated:</label>
                  {thumbnailHistory.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGoBackInHistory}
                      className="gap-1 h-6 text-xs text-muted-foreground hover:text-foreground px-2"
                    >
                      <ChevronLeft className="w-3 h-3" />
                      Previous
                    </Button>
                  )}
                </div>
                {generatedThumbnails.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadAllAsZip}
                    className="gap-1 h-6 px-2"
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                )}
              </div>

              {generatedThumbnails.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {thumbnailHistory.length > 0
                      ? 'No thumbnails. Click "Previous" to restore last batch.'
                      : 'Generated thumbnails will appear here'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Click to select. Hover for actions.
                  </p>
                  <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
                    {generatedThumbnails.map((url, index) => {
                      const isSelected = selectedThumbnail === url;
                      return (
                        <div key={index} className="relative group">
                          <img
                            src={url}
                            alt={`Thumbnail ${index + 1}`}
                            className={`w-full rounded-lg cursor-pointer transition-all ${
                              isSelected
                                ? 'ring-2 ring-primary ring-offset-1 opacity-100'
                                : 'border hover:opacity-90'
                            }`}
                            style={{ aspectRatio: '16/9', objectFit: 'cover' }}
                            onClick={() => setSelectedThumbnail(url)}
                            onDoubleClick={() => setLightboxImage(url)}
                          />
                          {isSelected && (
                            <div className="absolute top-1 left-1 bg-primary text-primary-foreground rounded-full p-0.5">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                          <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onFavoriteToggle && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 bg-background/80 hover:bg-background"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFavoriteToggle(url);
                                }}
                                title={favoriteThumbnails.includes(url) ? "Remove from favorites" : "Add to favorites"}
                              >
                                <Heart className={`w-3 h-3 ${favoriteThumbnails.includes(url) ? 'fill-red-500 text-red-500' : ''}`} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 bg-background/80 hover:bg-background"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightboxImage(url);
                              }}
                              title="Preview"
                            >
                              <Expand className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 bg-background/80 hover:bg-background"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUseAsReference(url);
                              }}
                              title="Use as reference"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 bg-background/80 hover:bg-background"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadThumbnail(url, index);
                              }}
                              title="Download"
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          {/* Left side: Navigation + Download */}
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} title="Back to previous step">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" size="icon" onClick={onSkip} title="Skip to next step">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
            {generatedThumbnails.length > 0 && (
              <Button variant="outline" onClick={handleDownloadAllAsZip}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            )}
          </div>

          {/* Right side: Exit + Forward/Continue */}
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Exit
          </Button>

          {onForward ? (
            <Button onClick={onForward}>
              YouTube
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={generatedThumbnails.length > 0 && !selectedThumbnail}
            >
              <Check className="w-4 h-4 mr-2" />
              {generatedThumbnails.length > 0 && !selectedThumbnail
                ? 'Select a Thumbnail'
                : 'Continue'}
            </Button>
          )}
        </DialogFooter>

        {/* Lightbox */}
        {lightboxImage && (
          <div
            ref={lightboxOverlayRef}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          >
            <img
              ref={lightboxImageRef}
              src={lightboxImage}
              alt="Full size preview"
              className="max-w-full max-h-full rounded-lg"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-white hover:bg-white/20"
              onClick={() => setLightboxImage(null)}
            >
              <X className="w-6 h-6" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
