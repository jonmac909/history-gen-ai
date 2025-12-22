import { useState, useEffect } from "react";
import { Check, X, Image as ImageIcon, Edit2, ChevronDown, ChevronUp } from "lucide-react";
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

interface ImagePrompt {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  sceneDescription: string;
}

interface ImagePromptsPreviewModalProps {
  isOpen: boolean;
  prompts: ImagePrompt[];
  onConfirm: (editedPrompts: ImagePrompt[]) => void;
  onCancel: () => void;
}

function formatTimecode(time: string): string {
  // Convert HH-MM-SS to HH:MM:SS for display
  return time.replace(/-/g, ':');
}

interface PromptCardProps {
  prompt: ImagePrompt;
  onUpdate: (updatedPrompt: ImagePrompt) => void;
}

function PromptCard({ prompt, onUpdate }: PromptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editedScene, setEditedScene] = useState(prompt.sceneDescription);

  // Sync with prompt changes
  useEffect(() => {
    setEditedScene(prompt.sceneDescription);
  }, [prompt.sceneDescription]);

  const hasChanges = editedScene !== prompt.sceneDescription;

  const handleSave = () => {
    onUpdate({
      ...prompt,
      sceneDescription: editedScene,
      prompt: prompt.prompt.replace(prompt.sceneDescription, editedScene)
    });
  };

  const handleReset = () => {
    setEditedScene(prompt.sceneDescription);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-medium text-lg">Image {prompt.index}</span>
          <span className="text-sm text-muted-foreground">
            {formatTimecode(prompt.startTime)} - {formatTimecode(prompt.endTime)}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 px-2"
        >
          <Edit2 className="w-4 h-4 mr-1" />
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>

      {isExpanded ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">
              Scene Description {hasChanges && <span className="text-yellow-500">(edited)</span>}
            </label>
            <textarea
              value={editedScene}
              onChange={(e) => setEditedScene(e.target.value)}
              className="w-full min-h-[100px] p-3 text-sm bg-background border rounded resize-y"
              placeholder="Describe the visual scene..."
            />
          </div>

          {hasChanges && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleReset}>
                Reset
              </Button>
              <Button size="sm" onClick={handleSave}>
                Apply Changes
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground line-clamp-3">
          {editedScene}
        </p>
      )}
    </div>
  );
}

export function ImagePromptsPreviewModal({
  isOpen,
  prompts,
  onConfirm,
  onCancel
}: ImagePromptsPreviewModalProps) {
  const [editedPrompts, setEditedPrompts] = useState<ImagePrompt[]>(prompts);

  // Sync with props when prompts change
  useEffect(() => {
    setEditedPrompts(prompts);
  }, [prompts]);

  const handleUpdatePrompt = (updatedPrompt: ImagePrompt) => {
    setEditedPrompts(prev =>
      prev.map(p => p.index === updatedPrompt.index ? updatedPrompt : p)
    );
  };

  const handleConfirm = () => {
    onConfirm(editedPrompts);
  };

  const editedCount = editedPrompts.filter((p, i) =>
    p.sceneDescription !== prompts[i]?.sceneDescription
  ).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-primary" />
            Review Image Prompts
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {prompts.length} images
            </span>
          </DialogTitle>
          <DialogDescription>
            Review and edit the scene descriptions before generating images.
            {editedCount > 0 && (
              <span className="text-yellow-500 ml-2">
                ({editedCount} edited)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full max-h-[60vh]">
            <div className="space-y-3 pr-4 py-4">
            {editedPrompts.map((prompt) => (
              <PromptCard
                key={prompt.index}
                prompt={prompt}
                onUpdate={handleUpdatePrompt}
              />
            ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>

          <Button onClick={handleConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Generate Images
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
