import { useState } from "react";
import { Settings, Minus, Plus } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { ScriptTemplate, CartesiaVoice } from "@/components/ConfigModal";

export interface GenerationSettings {
  scriptTemplate: string;
  voice: string;
  speed: number;
  imageCount: number;
  quality: string;
}

interface SettingsPopoverProps {
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
  scriptTemplates: ScriptTemplate[];
  cartesiaVoices: CartesiaVoice[];
}

const scriptTemplateOptions = [
  { value: "template-a", label: "Template A" },
  { value: "template-b", label: "Template B" },
  { value: "template-c", label: "Template C" },
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
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
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide uppercase">
              Generation Settings
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Script Template */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Script:
            </label>
            <Select
              value={settings.scriptTemplate}
              onValueChange={(value) => updateSetting("scriptTemplate", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {scriptTemplateOptions.map((template) => (
                  <SelectItem key={template.value} value={template.value}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Voice */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Voice:
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
                    <SelectItem key={voice.id} value={voice.id}>
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

          {/* Speed */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Speed:
            </label>
            <div className="px-3 py-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Speed</span>
                <span className="text-sm font-medium">{settings.speed.toFixed(1)}x</span>
              </div>
              <Slider
                value={[settings.speed]}
                onValueChange={(value) => updateSetting("speed", value[0])}
                min={0.6}
                max={1}
                step={0.1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0.6x</span>
                <span>1x</span>
              </div>
            </div>
          </div>

          {/* Image Model - Fixed to Seedream 4.5 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Model:
            </label>
            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-sm text-center">
              Seedream 4.5
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Quality:
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
              Select Your Count:
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
      </DialogContent>
    </Dialog>
  );
}
