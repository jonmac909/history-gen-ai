import { useState, useEffect } from "react";
import { Check, X, Image as ImageIcon, Edit2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Download, Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Predefined image style options
const IMAGE_STYLES = [
  {
    value: 'dutch-golden-age',
    label: 'Dutch Golden Age',
    prompt: 'In the style of Dutch Golden Age painting, rich warm tones, dramatic chiaroscuro lighting, Rembrandt-like composition, detailed textures, oil painting aesthetic, museum quality, historical accuracy'
  },
  {
    value: 'renaissance',
    label: 'Renaissance',
    prompt: 'In the style of Italian Renaissance art, classical composition, soft sfumato technique, Da Vinci-inspired, harmonious proportions, rich earth tones, fresco-like quality, timeless elegance'
  },
  {
    value: 'medieval',
    label: 'Medieval Illumination',
    prompt: 'In the style of medieval illuminated manuscripts, rich gold leaf accents, vibrant jewel-tone colors, decorative borders, flat perspective, intricate patterns, religious iconography influence'
  },
  {
    value: 'romantic',
    label: 'Romantic Era',
    prompt: 'In the style of Romantic era painting, dramatic landscapes, emotional and sublime lighting, Turner-inspired atmosphere, sweeping vistas, nature\'s power, golden hour ambiance'
  },
  {
    value: 'baroque',
    label: 'Baroque',
    prompt: 'In the style of Baroque painting, dramatic contrast and tenebrism, rich saturated colors, Caravaggio-inspired lighting, theatrical composition, dynamic movement, emotional intensity'
  },
  {
    value: 'impressionist',
    label: 'Impressionist',
    prompt: 'In the style of Impressionist painting, visible brushstrokes, natural outdoor light, Monet-inspired color palette, atmospheric effects, soft edges, everyday scenes captured beautifully'
  },
  {
    value: 'custom',
    label: 'Custom Style',
    prompt: ''
  },
];

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
  stylePrompt: string;
  onConfirm: (editedPrompts: ImagePrompt[], editedStylePrompt: string) => void;
  onCancel: () => void;
  onBack?: () => void;
  onForward?: () => void;
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
  stylePrompt,
  onConfirm,
  onCancel,
  onBack,
  onForward
}: ImagePromptsPreviewModalProps) {
  const [editedPrompts, setEditedPrompts] = useState<ImagePrompt[]>(prompts);
  const [isStyleExpanded, setIsStyleExpanded] = useState(false);

  // Detect if incoming stylePrompt matches a preset, default to Dutch Golden Age
  const detectStyleKey = (prompt: string): string => {
    const match = IMAGE_STYLES.find(s => s.prompt && s.prompt === prompt);
    if (match) return match.value;
    // If no match and prompt is empty or very short, default to Dutch Golden Age
    if (!prompt || prompt.trim().length < 20) return 'dutch-golden-age';
    return 'custom';
  };

  const [selectedStyleKey, setSelectedStyleKey] = useState<string>(() => detectStyleKey(stylePrompt));
  const [editedStyle, setEditedStyle] = useState(() => {
    // If stylePrompt is empty/short, use Dutch Golden Age preset
    if (!stylePrompt || stylePrompt.trim().length < 20) {
      const dutchStyle = IMAGE_STYLES.find(s => s.value === 'dutch-golden-age');
      return dutchStyle?.prompt || stylePrompt;
    }
    return stylePrompt;
  });

  // Sync with props when prompts change
  useEffect(() => {
    setEditedPrompts(prompts);
  }, [prompts]);

  // Sync style prompt when prop changes (but only if it's substantive)
  useEffect(() => {
    if (stylePrompt && stylePrompt.trim().length >= 20) {
      setEditedStyle(stylePrompt);
      setSelectedStyleKey(detectStyleKey(stylePrompt));
    }
  }, [stylePrompt]);

  const handleUpdatePrompt = (updatedPrompt: ImagePrompt) => {
    setEditedPrompts(prev =>
      prev.map(p => p.index === updatedPrompt.index ? updatedPrompt : p)
    );
  };

  const handleConfirm = () => {
    // Rebuild prompts with the current style
    const finalPrompts = editedPrompts.map(p => ({
      ...p,
      prompt: `${editedStyle}. ${p.sceneDescription}`
    }));
    onConfirm(finalPrompts, editedStyle);
  };

  const styleHasChanges = editedStyle !== stylePrompt;

  // Handle style preset selection
  const handleStyleSelect = (styleKey: string) => {
    setSelectedStyleKey(styleKey);
    const style = IMAGE_STYLES.find(s => s.value === styleKey);
    if (style && style.prompt) {
      setEditedStyle(style.prompt);
      setIsStyleExpanded(false); // Collapse when using preset
    } else if (styleKey === 'custom') {
      setIsStyleExpanded(true); // Expand for custom editing
    }
  };

  const handleDownload = () => {
    const data = editedPrompts.map(p => ({
      index: p.index,
      startTime: p.startTime,
      endTime: p.endTime,
      sceneDescription: p.sceneDescription,
      prompt: p.prompt
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'image-prompts.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

        {/* Image Style Selector */}
        <div className="border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Image Style</span>
            </div>
            <Select value={selectedStyleKey} onValueChange={handleStyleSelect}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a style..." />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_STYLES.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    {style.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Master Style Prompt Editor (collapsible for custom editing) */}
        <div className="border rounded-lg bg-muted/30">
          <button
            onClick={() => setIsStyleExpanded(!isStyleExpanded)}
            className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {selectedStyleKey === 'custom' ? 'Custom Style Prompt' : 'View/Edit Style Prompt'}
              </span>
              {styleHasChanges && <span className="text-xs text-yellow-500">(edited)</span>}
            </div>
            {isStyleExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {isStyleExpanded && (
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                This style is applied to all images. Edit to customize the look and feel.
              </p>
              <textarea
                value={editedStyle}
                onChange={(e) => {
                  setEditedStyle(e.target.value);
                  setSelectedStyleKey('custom'); // Switch to custom when manually editing
                }}
                className="w-full min-h-[120px] p-3 text-sm bg-background border rounded resize-y"
                placeholder="Describe the visual style..."
              />
              {styleHasChanges && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditedStyle(stylePrompt)}
                >
                  Reset to Original
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="overflow-y-auto max-h-[50vh] py-4 pr-2">
          <div className="space-y-3">
            {editedPrompts.map((prompt) => (
              <PromptCard
                key={prompt.index}
                prompt={prompt}
                onUpdate={handleUpdatePrompt}
              />
            ))}
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
            {onForward && (
              <Button variant="outline" size="icon" onClick={onForward} title="Skip to next step">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
            <Button variant="outline" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          {/* Right side: Exit + Continue */}
          <Button variant="outline" onClick={onCancel}>
            <X className="w-4 h-4 mr-2" />
            Exit
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
