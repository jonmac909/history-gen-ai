import { Check, X, Image as ImageIcon, RefreshCw, ZoomIn, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface ImagesPreviewModalProps {
  isOpen: boolean;
  images: string[];
  onConfirm: () => void;
  onCancel: () => void;
  onRegenerate?: (index: number) => void;
  regeneratingIndex?: number;
}

export function ImagesPreviewModal({
  isOpen,
  images,
  onConfirm,
  onCancel,
  onRegenerate,
  regeneratingIndex
}: ImagesPreviewModalProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  // Use functional updates to avoid stale closure issues
  const goToPrevious = useCallback(() => {
    setLightboxIndex(prev => {
      if (prev !== null && prev > 0) {
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const goToNext = useCallback(() => {
    setLightboxIndex(prev => {
      if (prev !== null && prev < images.length - 1) {
        return prev + 1;
      }
      return prev;
    });
  }, [images.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default and stop propagation to avoid Dialog handling these
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevious();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };

    // Use capture phase to intercept before Dialog
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [lightboxIndex, goToPrevious, goToNext]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-primary" />
            Preview Images
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {images.length} images generated
            </span>
          </DialogTitle>
          <DialogDescription>
            Review the generated images for your video.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 py-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pr-4">
            {images.map((imageUrl, index) => (
              <div
                key={index}
                className="relative aspect-video rounded-lg overflow-hidden border border-border bg-muted/30 group cursor-pointer"
                onClick={() => openLightbox(index)}
              >
                <img
                  src={imageUrl}
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
                {onRegenerate && (
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 p-0"
                      onClick={(e) => {
                        e.stopPropagation(); // Don't open lightbox when clicking regenerate
                        onRegenerate(index);
                      }}
                      disabled={regeneratingIndex === index}
                      title="Regenerate this image"
                    >
                      <RefreshCw className={`w-4 h-4 ${regeneratingIndex === index ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
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

    {/* Lightbox overlay - rendered via portal OUTSIDE the Dialog to avoid event conflicts */}
    {lightboxIndex !== null && createPortal(
      <div
        className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
        onClick={closeLightbox}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
          onClick={(e) => {
            e.stopPropagation();
            closeLightbox();
          }}
        >
          <X className="w-8 h-8" />
        </button>

        {/* Image counter */}
        <div className="absolute top-4 left-4 text-white/70 text-lg font-medium">
          {lightboxIndex + 1} / {images.length}
        </div>

        {/* Previous button */}
        {lightboxIndex > 0 && (
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors p-2"
            onClick={(e) => {
              e.stopPropagation();
              goToPrevious();
            }}
          >
            <ChevronLeft className="w-12 h-12" />
          </button>
        )}

        {/* Next button */}
        {lightboxIndex < images.length - 1 && (
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors p-2"
            onClick={(e) => {
              e.stopPropagation();
              goToNext();
            }}
          >
            <ChevronRight className="w-12 h-12" />
          </button>
        )}

        {/* Full-size image */}
        <img
          src={images[lightboxIndex]}
          alt={`Full size image ${lightboxIndex + 1}`}
          className="max-w-[90vw] max-h-[90vh] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>,
      document.body
    )}
  </>
  );
}
