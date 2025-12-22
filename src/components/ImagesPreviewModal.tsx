import { Check, X, Image as ImageIcon, RefreshCw, ZoomIn, Edit2, ChevronLeft, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ImagePrompt {
  index: number;
  prompt: string;
  sceneDescription: string;
}

interface ImagesPreviewModalProps {
  isOpen: boolean;
  images: string[];
  prompts?: ImagePrompt[];
  onConfirm: () => void;
  onCancel: () => void;
  onBack?: () => void;
  onRegenerate?: (index: number, editedPrompt?: string) => void;
  regeneratingIndex?: number;
}

export function ImagesPreviewModal({
  isOpen,
  images,
  prompts,
  onConfirm,
  onCancel,
  onBack,
  onRegenerate,
  regeneratingIndex
}: ImagesPreviewModalProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imageKeys, setImageKeys] = useState<Record<number, number>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedPrompt, setEditedPrompt] = useState("");
  const prevImagesRef = useRef<string[]>([]);

  // Refs for lightbox elements (needed for capture-phase click handling)
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  // Track image URL changes to bust cache - compare with previous URLs
  useEffect(() => {
    const newKeys = { ...imageKeys };
    let hasChanges = false;

    images.forEach((url, idx) => {
      // If URL changed from previous render, increment the key
      if (prevImagesRef.current[idx] !== url) {
        newKeys[idx] = Date.now();
        hasChanges = true;
      } else if (!(idx in newKeys)) {
        // Initialize key for new indices
        newKeys[idx] = Date.now();
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setImageKeys(newKeys);
    }

    // Store current images for next comparison
    prevImagesRef.current = [...images];
  }, [images]);

  // Add cache buster to image URL
  const getImageUrl = (url: string, index: number) => {
    const key = imageKeys[index] || Date.now();
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${key}`;
  };

  // Keyboard: ESC to close lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      }
    };

    // Use capture phase to intercept before Dialog
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [lightboxIndex]);

  // Click handling: background click closes, image click does nothing
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;

      // If clicked on image, do nothing (don't close)
      if (imageRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If clicked on overlay background, close
      if (overlayRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      }
    };

    // Use capture phase to intercept before Radix Dialog's event handlers
    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [lightboxIndex]);

  const handleEditClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const prompt = prompts?.[index];
    if (prompt) {
      setEditedPrompt(prompt.sceneDescription);
      setEditingIndex(index);
    }
  };

  const handleSaveAndRegenerate = () => {
    if (editingIndex !== null && onRegenerate) {
      onRegenerate(editingIndex, editedPrompt);
      setEditingIndex(null);
      setEditedPrompt("");
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditedPrompt("");
  };

  const handleDownloadAll = async () => {
    // Download each image sequentially
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${String(i + 1).padStart(3, '0')}.png`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] flex flex-col"
        onPointerDownOutside={(e) => {
          // Prevent Dialog from closing when clicking on the lightbox overlay
          if (lightboxIndex !== null) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Prevent Dialog from closing when interacting with the lightbox
          if (lightboxIndex !== null) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-primary" />
            Preview Images
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {images.length} images generated
            </span>
          </DialogTitle>
          <DialogDescription>
            Review the generated images. Click edit to modify the prompt and regenerate.
          </DialogDescription>
        </DialogHeader>

        {/* Prompt editing panel */}
        {editingIndex !== null && prompts && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Edit Prompt for Image {editingIndex + 1}</span>
              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              className="w-full min-h-[100px] p-3 text-sm bg-background border rounded resize-y"
              placeholder="Describe the visual scene..."
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAndRegenerate}
                disabled={regeneratingIndex === editingIndex}
              >
                {regeneratingIndex === editingIndex ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Save & Regenerate
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-y-auto max-h-[60vh] py-4 pr-2">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {images.map((imageUrl, index) => (
              <div
                key={`${index}-${imageKeys[index] || 0}`}
                className="relative aspect-video rounded-lg overflow-hidden border border-border bg-muted/30 group cursor-pointer"
                onClick={() => openLightbox(index)}
              >
                <img
                  src={getImageUrl(imageUrl, index)}
                  alt={`Generated image ${index + 1}`}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-background/80 rounded text-xs font-medium">
                  {index + 1}
                </div>
                {/* Zoom hint on hover */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-70 transition-opacity" />
                </div>
                {/* Action buttons on hover */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-1">
                  {prompts && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 p-0"
                      onClick={(e) => handleEditClick(e, index)}
                      disabled={regeneratingIndex === index}
                      title="Edit prompt"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  )}
                  {onRegenerate && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRegenerate(index);
                      }}
                      disabled={regeneratingIndex === index}
                      title="Regenerate this image"
                    >
                      <RefreshCw className={`w-4 h-4 ${regeneratingIndex === index ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            <Button variant="outline" onClick={handleDownloadAll}>
              <Download className="w-4 h-4 mr-2" />
              Download All
            </Button>
          </div>
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>

          <Button onClick={onConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Lightbox overlay - click background or press ESC to close */}
    {lightboxIndex !== null && createPortal(
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center cursor-pointer"
      >
        {/* Image counter */}
        <div className="absolute top-4 left-4 text-white/70 text-lg font-medium pointer-events-none">
          {lightboxIndex + 1} / {images.length}
        </div>

        {/* Hint text */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-sm pointer-events-none">
          Press ESC or click outside to close
        </div>

        {/* Full-size image */}
        <img
          ref={imageRef}
          src={getImageUrl(images[lightboxIndex], lightboxIndex)}
          alt={`Full size image ${lightboxIndex + 1}`}
          className="max-w-[90vw] max-h-[90vh] object-contain cursor-default"
        />
      </div>,
      document.body
    )}
  </>
  );
}
