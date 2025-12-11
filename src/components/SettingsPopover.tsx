import { useState } from "react";
import { Settings, Minus, Plus } from "lucide-react";
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
import type { ScriptTemplate, CartesiaVoice } from "@/components/ApiKeysModal";

export interface GenerationSettings {
  scriptTemplate: string;
  voice: string;
  imageCount: number;
  aspectRatio: string;
  quality: string;
}

interface SettingsPopoverProps {
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
  scriptTemplates: ScriptTemplate[];
  cartesiaVoices: CartesiaVoice[];
}

const aspectRatios = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "21:9", label: "21:9 (Ultrawide)" },
];

const qualityOptions = [
  { value: "basic", label: "Basic (2K)" },
  { value: "high", label: "High (4K)" },
];

export function SettingsPopover({ 
  settings, 
  onSettingsChange, 
  scriptTemplates,
  cartesiaVoices,
}: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const currentTemplate = scriptTemplates.find(t => t.id === settings.scriptTemplate);

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
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {scriptTemplates.length > 0 ? (
                  scriptTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name || `Template ${template.id}`}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No templates configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {currentTemplate?.description && (
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
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                {cartesiaVoices.length > 0 ? (
                  cartesiaVoices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.voiceId}>
                      {voice.name || voice.voiceId}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No voices configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Image Model - Fixed to Seedream 4.5 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Image Model (Kie.ai)
            </label>
            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-sm text-center">
              Seedream 4.5
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Aspect Ratio
            </label>
            <Select
              value={settings.aspectRatio}
              onValueChange={(value) => updateSetting("aspectRatio", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aspectRatios.map((ratio) => (
                  <SelectItem key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Image Quality
            </label>
            <Select
              value={settings.quality}
              onValueChange={(value) => updateSetting("quality", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {qualityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
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
              <span className="text-sm text-muted-foreground">Images</span>
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