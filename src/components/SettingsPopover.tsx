import React, { useState } from "react";
import { Settings, Minus, Plus, X, Zap, Rabbit } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import { VoiceSampleUpload } from "@/components/VoiceSampleUpload";
import type { ScriptTemplate } from "@/components/ConfigModal";

export interface GenerationSettings {
  projectTitle: string;
  fullAutomation: boolean;
  fastMode: boolean;
  scriptTemplate: string;
  aiModel: string;
  voiceSampleUrl: string | null;
  speed: number;
  imageCount: number;
  wordCount: number;
  quality: string;
  customScript?: string;
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
  const [localSettings, setLocalSettings] = useState(settings);

  // Sync local settings when props change (but not when modal is open)
  React.useEffect(() => {
    if (!isOpen) {
      setLocalSettings(settings);
    }
  }, [settings, isOpen]);

  // Build template options from scriptTemplates with custom names or defaults
  const scriptTemplateOptions = scriptTemplates.map((template) => ({
    value: template.id,
    label: template.name || defaultTemplateLabels[template.id] || template.id,
  }));

  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleClose = () => {
    onSettingsChange(localSettings);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className={`shrink-0 transition-colors ${
            isOpen
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-md"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide uppercase">
              Generation Settings
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4 px-1 max-h-[70vh] overflow-y-auto">
          {/* Project Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Project Title:
            </label>
            <Input
              placeholder="Enter a name for this project..."
              value={localSettings.projectTitle || ""}
              onChange={(e) => updateSetting("projectTitle", e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="text-center"
            />
          </div>

          {/* Full Automation Toggle */}
          <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <div>
                <span className="text-sm font-medium">Full Automation</span>
                <p className="text-xs text-muted-foreground">
                  Auto-confirm each step & render video
                </p>
              </div>
            </div>
            <Switch
              checked={localSettings.fullAutomation || false}
              onCheckedChange={(checked) => updateSetting("fullAutomation", checked)}
            />
          </div>

          {/* Fast Mode Toggle */}
          <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <Rabbit className="w-4 h-4 text-primary" />
              <div>
                <span className="text-sm font-medium">Fast Mode</span>
                <p className="text-xs text-muted-foreground">
                  3x faster script generation (uses Haiku)
                </p>
              </div>
            </div>
            <Switch
              checked={localSettings.fastMode || false}
              onCheckedChange={(checked) => updateSetting("fastMode", checked)}
            />
          </div>

          {/* Custom Script Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Paste Your Own Script (Optional):
            </label>
            <p className="text-xs text-muted-foreground text-center">
              Skip YouTube fetch and AI rewriting - go straight to audio generation
            </p>
            <Textarea
              placeholder="Paste your pre-written script here to skip the transcript and rewriting steps..."
              value={localSettings.customScript || ""}
              onChange={(e) => updateSetting("customScript", e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="min-h-[120px] resize-y"
            />
            {localSettings.customScript && localSettings.customScript.trim().length > 0 && (
              <p className="text-xs text-primary text-center">
                ✓ Custom script ready ({localSettings.customScript.trim().split(/\s+/).length} words)
              </p>
            )}
          </div>

          {/* Script Template */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Script Template:
            </label>
            <p className="text-xs text-muted-foreground text-center">
              {localSettings.customScript && localSettings.customScript.trim().length > 0
                ? "(Ignored when using custom script)"
                : "For AI-generated scripts from YouTube"}
            </p>
            <Select
              value={localSettings.scriptTemplate}
              onValueChange={(value) => updateSetting("scriptTemplate", value)}
              disabled={!!(localSettings.customScript && localSettings.customScript.trim().length > 0)}
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

          {/* Voice Sample Upload */}
          <VoiceSampleUpload
            voiceSampleUrl={localSettings.voiceSampleUrl}
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
                <span className="text-sm font-medium">{localSettings.speed.toFixed(1)}x</span>
              </div>
              <Slider
                value={[localSettings.speed]}
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
                  onClick={() => updateSetting("imageCount", Math.max(1, localSettings.imageCount - 1))}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={localSettings.imageCount}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 1 && value <= 200) {
                      updateSetting("imageCount", value);
                    }
                  }}
                  className="w-16 h-8 text-center font-medium px-2"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSetting("imageCount", Math.min(200, localSettings.imageCount + 1))}
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
                <span className="text-sm font-medium">{localSettings.wordCount.toLocaleString()}</span>
              </div>
              <Slider
                value={[localSettings.wordCount]}
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

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="w-full">
            <X className="w-4 h-4 mr-2" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
