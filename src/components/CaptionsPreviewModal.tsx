import { useState, useEffect } from "react";
import { Check, X, Edit3, FileText, ChevronLeft, Download } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";

interface CaptionsPreviewModalProps {
  isOpen: boolean;
  srtContent: string;
  onConfirm: (srtContent: string) => void;
  onCancel: () => void;
  onBack?: () => void;
}

export function CaptionsPreviewModal({
  isOpen,
  srtContent,
  onConfirm,
  onCancel,
  onBack
}: CaptionsPreviewModalProps) {
  const [editedSrt, setEditedSrt] = useState(srtContent);
  const [isEditing, setIsEditing] = useState(false);

  // Sync state when srtContent prop changes
  useEffect(() => {
    if (srtContent) {
      setEditedSrt(srtContent);
    }
  }, [srtContent]);

  // Count caption entries
  const captionCount = (editedSrt.match(/^\d+$/gm) || []).length;

  const handleConfirm = () => {
    onConfirm(editedSrt);
  };

  const handleDownload = () => {
    const blob = new Blob([editedSrt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captions.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Preview Captions
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {captionCount} segments
            </span>
          </DialogTitle>
          <DialogDescription>
            Review the generated SRT captions before generating images.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-4">
          {isEditing ? (
            <Textarea
              value={editedSrt}
              onChange={(e) => setEditedSrt(e.target.value)}
              className="h-[50vh] font-mono text-sm resize-none"
              placeholder="SRT content..."
            />
          ) : (
            <ScrollArea className="h-[50vh] rounded-lg border border-border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-foreground leading-relaxed">
                {editedSrt}
              </pre>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setIsEditing(!isEditing)}
            >
              <Edit3 className="w-4 h-4 mr-2" />
              {isEditing ? "Preview" : "Edit"}
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>

          <Button onClick={handleConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Confirm & Generate Images
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
