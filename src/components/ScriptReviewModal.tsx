import { useState, useEffect } from "react";
import { Check, X, Edit3, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ScriptReviewModalProps {
  isOpen: boolean;
  script: string;
  onConfirm: (script: string) => void;
  onCancel: () => void;
}

export function ScriptReviewModal({ 
  isOpen, 
  script, 
  onConfirm, 
  onCancel 
}: ScriptReviewModalProps) {
  const [editedScript, setEditedScript] = useState(script);
  const [isEditing, setIsEditing] = useState(false);

  // Update editedScript when script prop changes
  useEffect(() => {
    if (script) {
      setEditedScript(script);
    }
  }, [script]);

  const wordCount = editedScript.split(/\s+/).filter(Boolean).length;

  const handleConfirm = () => {
    onConfirm(editedScript);
  };

  // Show loading if script is empty
  if (isOpen && !script) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground mt-4">Loading script...</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            Review Script
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {wordCount.toLocaleString()} words
            </span>
          </DialogTitle>
          <p className="text-muted-foreground">
            Review and edit the generated script before creating audio.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-4">
          {isEditing ? (
            <Textarea
              value={editedScript}
              onChange={(e) => setEditedScript(e.target.value)}
              className="h-[50vh] font-mono text-sm resize-none"
              placeholder="Script content..."
            />
          ) : (
            <ScrollArea className="h-[50vh] rounded-lg border border-border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-foreground leading-relaxed">
                {editedScript}
              </pre>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => setIsEditing(!isEditing)}
            className="mr-auto"
          >
            <Edit3 className="w-4 h-4 mr-2" />
            {isEditing ? "Preview" : "Edit"}
          </Button>
          
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          
          <Button onClick={handleConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Confirm & Generate Audio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
