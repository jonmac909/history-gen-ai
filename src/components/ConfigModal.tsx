import { useState, useEffect } from "react";
import { Settings, FileText, Image, Loader2, RefreshCw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ScriptTemplate {
  id: string;
  template: string;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  voiceId: string;
  referenceAudioUrl?: string;
  isCustom?: boolean;
  category?: string;
  previewUrl?: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

interface ConfigModalProps {
  scriptTemplates: ScriptTemplate[];
  onSaveTemplates: (templates: ScriptTemplate[]) => void;
  cartesiaVoices: CartesiaVoice[];
  onSaveVoices: (voices: CartesiaVoice[]) => void;
  imageStylePrompt: string;
  onSaveImageStylePrompt: (prompt: string) => void;
  selectedVoiceId?: string;
  onSelectVoice?: (voiceId: string) => void;
}

export function ConfigModal({ 
  scriptTemplates,
  onSaveTemplates,
  cartesiaVoices,
  onSaveVoices,
  imageStylePrompt,
  onSaveImageStylePrompt,
  selectedVoiceId,
  onSelectVoice,
}: ConfigModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<ScriptTemplate[]>(scriptTemplates);
  const [voices, setVoices] = useState<CartesiaVoice[]>(cartesiaVoices);
  const [stylePrompt, setStylePrompt] = useState(imageStylePrompt);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [localSelectedVoiceId, setLocalSelectedVoiceId] = useState(selectedVoiceId || '3GntEbfzhYH3X9VCuIHy');

  const fetchElevenLabsVoices = async () => {
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-elevenlabs-voices');
      
      if (error) throw error;
      
      if (data.voices) {
        setElevenLabsVoices(data.voices);
        toast({ title: "Voices loaded", description: `Found ${data.voices.length} voices` });
      }
    } catch (error) {
      console.error('Error fetching voices:', error);
      toast({ title: "Error", description: "Failed to fetch ElevenLabs voices", variant: "destructive" });
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (isOpen && elevenLabsVoices.length === 0) {
      fetchElevenLabsVoices();
    }
  }, [isOpen]);

  const handleSave = () => {
    onSaveTemplates(templates);
    onSaveVoices(voices);
    onSaveImageStylePrompt(stylePrompt);
    if (onSelectVoice) {
      onSelectVoice(localSelectedVoiceId);
    }
    setIsOpen(false);
  };

  const updateTemplate = (id: string, field: keyof ScriptTemplate, value: string) => {
    setTemplates(prev => prev.map(t => 
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const playPreview = async (previewUrl: string, voiceId: string) => {
    if (playingPreview === voiceId) {
      setPlayingPreview(null);
      return;
    }
    
    setPlayingPreview(voiceId);
    try {
      const audio = new Audio(previewUrl);
      audio.onended = () => setPlayingPreview(null);
      audio.onerror = () => {
        setPlayingPreview(null);
        toast({ title: "Preview failed", description: "Could not play voice preview", variant: "destructive" });
      };
      await audio.play();
    } catch (error) {
      setPlayingPreview(null);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'cloned': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'generated': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'professional': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Configuration
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="voices" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="templates">Script Templates</TabsTrigger>
            <TabsTrigger value="voices">Voices</TabsTrigger>
            <TabsTrigger value="image-style">Image Style</TabsTrigger>
          </TabsList>

          {/* Script Templates Tab */}
          <TabsContent value="templates" className="space-y-6 py-4">
            <p className="text-sm text-muted-foreground">
              Configure your 3 script templates for Claude to use when generating scripts.
            </p>
            
            {templates.map((template, index) => (
              <div key={template.id} className="space-y-3 p-4 border border-border rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-medium">Template {String.fromCharCode(65 + index)}</span>
                </div>
                
                <div className="space-y-2">
                  <Label>Template Content</Label>
                  <Textarea
                    value={template.template}
                    onChange={(e) => updateTemplate(template.id, "template", e.target.value)}
                    placeholder="Paste your full script template here..."
                    className="min-h-[150px] font-mono text-sm"
                  />
                </div>
              </div>
            ))}
          </TabsContent>

          {/* Voices Tab */}
          <TabsContent value="voices" className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Select a voice from your ElevenLabs account for audio generation.
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={fetchElevenLabsVoices}
                disabled={loadingVoices}
                className="gap-2"
              >
                {loadingVoices ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh
              </Button>
            </div>

            {loadingVoices ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : elevenLabsVoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No voices found. Click Refresh to load your ElevenLabs voices.</p>
              </div>
            ) : (
              <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                {elevenLabsVoices.map((voice) => (
                  <div 
                    key={voice.voice_id}
                    onClick={() => setLocalSelectedVoiceId(voice.voice_id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all",
                      localSelectedVoiceId === voice.voice_id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-3 h-3 rounded-full border-2",
                        localSelectedVoiceId === voice.voice_id
                          ? "bg-primary border-primary"
                          : "border-muted-foreground"
                      )} />
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {voice.name}
                          <Badge variant="outline" className={cn("text-[10px] px-1.5", getCategoryColor(voice.category))}>
                            {voice.category}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {voice.voice_id}
                        </div>
                      </div>
                    </div>
                    
                    {voice.preview_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          playPreview(voice.preview_url!, voice.voice_id);
                        }}
                        className="shrink-0"
                      >
                        <Volume2 className={cn(
                          "w-4 h-4",
                          playingPreview === voice.voice_id && "text-primary animate-pulse"
                        )} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {localSelectedVoiceId && (
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/30">
                <p className="text-sm">
                  <span className="text-muted-foreground">Selected voice: </span>
                  <span className="font-medium">
                    {elevenLabsVoices.find(v => v.voice_id === localSelectedVoiceId)?.name || localSelectedVoiceId}
                  </span>
                </p>
              </div>
            )}
          </TabsContent>

          {/* Image Style Tab */}
          <TabsContent value="image-style" className="space-y-4 py-4">
            <div className="flex items-center gap-2 mb-4">
              <Image className="w-4 h-4 text-primary" />
              <span className="font-medium">Image Style Prompt</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Define the visual style for generated images. This prompt will be used to guide the image generation.
            </p>
            <Textarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="e.g., Cinematic, dramatic lighting, 4K quality, photorealistic..."
              className="min-h-[200px]"
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Configuration
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
