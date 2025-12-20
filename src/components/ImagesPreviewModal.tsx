import { Check, X, Image as ImageIcon, RefreshCw } from "lucide-react";
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
import { useState } from "react";

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
  return (
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
                className="relative aspect-video rounded-lg overflow-hidden border border-border bg-muted/30 group"
              >
                <img
                  src={imageUrl}
                  alt={`Generated image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-background/80 rounded text-xs font-medium">
                  {index + 1}
                </div>
                {onRegenerate && (
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 p-0"
                      onClick={() => onRegenerate(index)}
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
  );
}
