import { useState, useEffect, useRef } from "react";
import { Settings, Minus, Plus, Loader2, Volume2, Upload, X } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { ScriptTemplate } from "@/components/ConfigModal";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

export interface GenerationSettings {
  scriptTemplate: string;
  aiModel: string;
  voice: string;
  speed: number;
  imageCount: number;
  wordCount: number;
  quality: string;
  ttsEngine: 'elevenlabs' | 'openvoice';
  customVoiceUrl?: string;
}

const aiModelOptions = [
  { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1", description: "Most intelligent, expensive" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", description: "Smart, efficient for everyday use" },
];

interface SettingsPopoverProps {
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
  scriptTemplates: ScriptTemplate[];
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
}: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchElevenLabsVoices = async () => {
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-elevenlabs-voices');
      if (error) throw error;
      if (data.voices) {
        setElevenLabsVoices(data.voices);
      }
    } catch (error) {
      console.error('Error fetching voices:', error);
      toast({ title: "Error", description: "Failed to fetch voices", variant: "destructive" });
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (isOpen && elevenLabsVoices.length === 0) {
      fetchElevenLabsVoices();
    }
  }, [isOpen]);

  const playPreview = async (previewUrl: string, voiceId: string) => {
    if (playingPreview === voiceId) {
      setPlayingPreview(null);
      return;
    }
    setPlayingPreview(voiceId);
    try {
      const audio = new Audio(previewUrl);
      audio.onended = () => setPlayingPreview(null);
      audio.onerror = () => setPlayingPreview(null);
      await audio.play();
    } catch (error) {
      setPlayingPreview(null);
    }
  };

  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleVoiceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      toast({ title: "Error", description: "Please upload an audio file (WAV, MP3, etc.)", variant: "destructive" });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Error", description: "File size must be under 10MB", variant: "destructive" });
      return;
    }

    setUploadingVoice(true);
    try {
      const fileName = `voice-samples/${Date.now()}-${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('voice-samples')
        .upload(fileName, file, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('voice-samples')
        .getPublicUrl(fileName);

      updateSetting("customVoiceUrl", urlData.publicUrl);
      toast({ title: "Success", description: "Voice sample uploaded!" });
    } catch (error) {
      console.error('Upload error:', error);
      toast({ title: "Error", description: "Failed to upload voice sample", variant: "destructive" });
    } finally {
      setUploadingVoice(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeCustomVoice = () => {
    updateSetting("customVoiceUrl", undefined);
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
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide uppercase">
              Generation Settings
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 overflow-y-auto flex-1 px-1">
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

          {/* AI Model */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your Model:
            </label>
            <Select
              value={settings.aiModel}
              onValueChange={(value) => updateSetting("aiModel", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {aiModelOptions.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* TTS Engine */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-center block">
              Select Your TTS Engine:
            </label>
            <Select
              value={settings.ttsEngine}
              onValueChange={(value: 'elevenlabs' | 'openvoice') => updateSetting("ttsEngine", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openvoice">
                  <div className="flex flex-col">
                    <span>OpenVoice (Cheaper)</span>
                    <span className="text-xs text-muted-foreground">~$0.009/generation</span>
                  </div>
                </SelectItem>
                <SelectItem value="elevenlabs">
                  <div className="flex flex-col">
                    <span>ElevenLabs (Premium)</span>
                    <span className="text-xs text-muted-foreground">~$10/15K words</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice - only show for ElevenLabs */}
          {settings.ttsEngine === 'elevenlabs' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-center block">
                Select Your Voice:
              </label>
              <div className="flex gap-2">
                <Select
                  value={settings.voice}
                  onValueChange={(value) => updateSetting("voice", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingVoices ? "Loading voices..." : "Select a voice"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {loadingVoices ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    ) : elevenLabsVoices.length > 0 ? (
                      elevenLabsVoices.map((voice) => (
                        <SelectItem key={voice.voice_id} value={voice.voice_id}>
                          <div className="flex items-center gap-2">
                            <span>{voice.name}</span>
                            <span className="text-xs text-muted-foreground">({voice.category})</span>
                          </div>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No voices found
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {settings.voice && elevenLabsVoices.find(v => v.voice_id === settings.voice)?.preview_url && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      const voice = elevenLabsVoices.find(v => v.voice_id === settings.voice);
                      if (voice?.preview_url) {
                        playPreview(voice.preview_url, voice.voice_id);
                      }
                    }}
                  >
                    <Volume2 className={`w-4 h-4 ${playingPreview === settings.voice ? "text-primary animate-pulse" : ""}`} />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* OpenVoice voice upload */}
          {settings.ttsEngine === 'openvoice' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-center block">
                Your Voice Sample:
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleVoiceUpload}
                className="hidden"
              />
              {settings.customVoiceUrl ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-lg">
                  <Volume2 className="w-4 h-4 text-primary" />
                  <span className="text-sm flex-1 truncate">Voice sample uploaded</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => {
                      const audio = new Audio(settings.customVoiceUrl);
                      audio.play();
                    }}
                  >
                    <Volume2 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-destructive"
                    onClick={removeCustomVoice}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingVoice}
                >
                  {uploadingVoice ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {uploadingVoice ? "Uploading..." : "Upload Voice Sample"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Upload a 10-30 second clear audio sample of your voice
              </p>
            </div>
          )}

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
              Select Your Image Model:
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
                min={1000}
                max={30000}
                step={1000}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1,000</span>
                <span>30,000</span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
