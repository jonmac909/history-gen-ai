import { useState } from "react";
import { Settings, ChevronDown, Minus, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface GenerationSettings {
  scriptTemplate: string;
  voice: string;
  imageModel: string;
  imageCount: number;
}

interface SettingsPopoverProps {
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
}

const scriptTemplates = [
  { value: "dramatic", label: "Template A: Dramatic Storytelling", description: "Focus on narrative arc and suspense" },
  { value: "educational", label: "Template B: Educational", description: "Focus on facts and learning" },
  { value: "documentary", label: "Template C: Documentary", description: "Neutral, informative tone" },
];

const voices = [
  { value: "british-male", label: "British Historian (Male)" },
  { value: "british-female", label: "British Historian (Female)" },
  { value: "american-male", label: "American Narrator (Male)" },
  { value: "american-female", label: "American Narrator (Female)" },
];

const imageModels = [
  { value: "historical-v2", label: "Historical Realism v2" },
  { value: "historical-v1", label: "Historical Realism v1" },
  { value: "artistic", label: "Artistic Interpretation" },
  { value: "cinematic", label: "Cinematic Style" },
];

export function SettingsPopover({ settings, onSettingsChange }: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const currentTemplate = scriptTemplates.find(t => t.value === settings.scriptTemplate);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`shrink-0 transition-colors ${
            isOpen 
              ? "bg-primary text-primary-foreground hover:bg-primary/90" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-6" 
        align="end"
        sideOffset={8}
      >
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide uppercase">
              Generation Settings
            </span>
          </div>

          {/* Script Template */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Script Template (Claude)
            </label>
            <Select
              value={settings.scriptTemplate}
              onValueChange={(value) => updateSetting("scriptTemplate", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scriptTemplates.map((template) => (
                  <SelectItem key={template.value} value={template.value}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentTemplate && (
              <p className="text-xs text-muted-foreground text-center">
                {currentTemplate.description}
              </p>
            )}
          </div>

          {/* Voice */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Voice (Cartesia)
            </label>
            <Select
              value={settings.voice}
              onValueChange={(value) => updateSetting("voice", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {voices.map((voice) => (
                  <SelectItem key={voice.value} value={voice.value}>
                    {voice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Image Model */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Image Model (kie.ai)
            </label>
            <Select
              value={settings.imageModel}
              onValueChange={(value) => updateSetting("imageModel", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageModels.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Image Count */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Image Count
            </label>
            <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-2">
              <span className="text-sm text-muted-foreground">Image Count</span>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSetting("imageCount", Math.max(1, settings.imageCount - 1))}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-6 text-center font-medium">{settings.imageCount}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSetting("imageCount", Math.min(30, settings.imageCount + 1))}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}