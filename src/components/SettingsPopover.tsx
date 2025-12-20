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
import { Input } from "@/components/ui/input";
import { VoiceSampleUpload } from "@/components/VoiceSampleUpload";
import type { ScriptTemplate } from "@/components/ConfigModal";

export interface GenerationSettings {
  scriptTemplate: string;
  aiModel: string;
  voiceSampleUrl: string | null;
  speed: number;
  imageCount: number;
  wordCount: number;
  quality: string;
  name?: string;
}


interface SettingsPopoverProps {
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
  scriptTemplates: ScriptTemplate[];
}

const defaultTemplateLabels: Record<string, string> = {
  "template-a": "Template A",
  "template-b": "Template B",
  "template-c": "Template C",
  "template-d": "Template D",
  "template-e": "Template E",
};

export function SettingsPopover({
  settings,
  onSettingsChange,
  scriptTemplates,
}: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Build template options from scriptTemplates with custom names or defaults
  const scriptTemplateOptions = scriptTemplates.map((template) => ({
    value: template.id,
    label: template.name || defaultTemplateLabels[template.id] || template.id,
  }));

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
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide uppercase">
              Generation Settings
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4 px-1">
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

          {/* AI Model - Fixed to Claude Sonnet 4.5 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Model:
            </label>
            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-sm text-center">
              Claude Sonnet 4.5
            </div>
          </div>

          {/* Voice Sample Upload */}
          <VoiceSampleUpload
            voiceSampleUrl={settings.voiceSampleUrl}
            onVoiceSampleChange={(url) => updateSetting("voiceSampleUrl", url)}
          />

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

          {/* Image Model - Fixed to Z-Image */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Image Model:
            </label>
            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-sm text-center">
              Z-IMAGE
            </div>
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
                <Input
                  type="number"
                  min={1}
                  value={settings.imageCount}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 1) {
                      updateSetting("imageCount", value);
                    }
                  }}
                  className="w-16 h-8 text-center font-medium px-2"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSetting("imageCount", settings.imageCount + 1)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Word Count */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Word Count:
            </label>
            <div className="px-3 py-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Words</span>
                <span className="text-sm font-medium">{settings.wordCount.toLocaleString()}</span>
              </div>
              <Slider
                value={[settings.wordCount]}
                onValueChange={(value) => updateSetting("wordCount", value[0])}
                min={500}
                max={30000}
                step={500}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>500</span>
                <span>30,000</span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
