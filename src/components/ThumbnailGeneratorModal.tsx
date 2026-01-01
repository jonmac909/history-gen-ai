import { useState, useRef, useEffect } from "react";
import { Image, Upload, X, Loader2, Download, Sparkles, ChevronLeft, Check, ArrowUp } from "lucide-react";
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
  onConfirm: (thumbnails: string[]) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
}

export function ThumbnailGeneratorModal({
  isOpen,
  projectId,
  onConfirm,
  onBack,
  onSkip,
}: ThumbnailGeneratorModalProps) {
  // Upload state
  const [exampleImage, setExampleImage] = useState<File | null>(null);
  const [examplePreview, setExamplePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generation state - single prompt for everything
  const [imagePrompt, setImagePrompt] = useState("");
  const [thumbnailCount, setThumbnailCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ThumbnailGenerationProgress | null>(null);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);

  // Selection state - which thumbnail is selected for YouTube upload
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(null);

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
      // Extract base64 from data URL
      const base64Match = examplePreview.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match) {
        throw new Error("Invalid image format");
      }
      const base64Data = base64Match[1];

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
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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

  const handleComplete = () => {
    // Pass only the selected thumbnail (or empty array if none selected)
    onConfirm(selectedThumbnail ? [selectedThumbnail] : []);
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
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

        <div className="space-y-5 py-4">
          {/* Upload Example Thumbnail */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Upload Reference Thumbnail:</label>
            <p className="text-xs text-muted-foreground">
              This image will be used as a base for generating variations
            </p>

            {examplePreview ? (
              <div className="relative inline-block">
                <img
                  src={examplePreview}
                  alt="Example thumbnail"
                  className="w-48 h-auto rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
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
            ) : (
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Loading...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Click to upload reference thumbnail
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PNG, JPG, or WebP (max 20MB)
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
            <label className="text-sm font-medium">Image Prompt:</label>
            <Textarea
              placeholder="Describe what you want to generate. Include style, colors, composition, mood, and any text/typography..."
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="min-h-[150px] resize-y font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Describe the content, style, colors, composition, mood, and any text you want on the thumbnail.
            </p>
          </div>

          {/* Thumbnail Count */}
          <div className="space-y-2">
            <label className="text-sm font-medium">How many thumbnails?</label>
            <div className="flex gap-2">
              {[3, 5, 10].map((count) => (
                <Button
                  key={count}
                  variant={thumbnailCount === count ? "default" : "outline"}
                  size="sm"
                  onClick={() => setThumbnailCount(count)}
                  disabled={isGenerating}
                >
                  {count}
                </Button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={!examplePreview || !imagePrompt.trim() || isGenerating}
            className="w-full gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Thumbnails
              </>
            )}
          </Button>

          {/* Progress */}
          {progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.stage === 'analyzing' ? 'Processing...' : 'Generating thumbnails...'}
                </span>
                <span className="font-medium">{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} className="h-2" />
              <p className="text-xs text-muted-foreground">{progress.message}</p>
            </div>
          )}

          {/* Generated Thumbnails */}
          {generatedThumbnails.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Generated Thumbnails:</label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadAllAsZip}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download All
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Click to select a thumbnail for YouTube upload. Double-click to preview full size.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {generatedThumbnails.map((url, index) => {
                  const isSelected = selectedThumbnail === url;
                  return (
                    <div key={index} className="relative group">
                      <img
                        src={url}
                        alt={`Thumbnail ${index + 1}`}
                        className={`w-full rounded-lg cursor-pointer transition-all ${
                          isSelected
                            ? 'ring-4 ring-primary ring-offset-2 opacity-100'
                            : 'border hover:opacity-90'
                        }`}
                        style={{ aspectRatio: '16/9', objectFit: 'cover' }}
                        onClick={() => setSelectedThumbnail(url)}
                        onDoubleClick={() => setLightboxImage(url)}
                      />
                      {isSelected && (
                        <div className="absolute top-2 left-2 bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                      <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 bg-background/80 hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUseAsReference(url);
                          }}
                          title="Use as new reference"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 bg-background/80 hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadThumbnail(url, index);
                          }}
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {onBack && (
              <Button variant="outline" onClick={onBack} className="gap-2">
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            )}
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            )}
          </div>
          <Button
            onClick={handleComplete}
            disabled={generatedThumbnails.length > 0 && !selectedThumbnail}
            className="gap-2 w-full sm:w-auto"
          >
            <Check className="w-4 h-4" />
            {generatedThumbnails.length > 0 && !selectedThumbnail
              ? 'Select a Thumbnail'
              : 'Continue'}
          </Button>
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
