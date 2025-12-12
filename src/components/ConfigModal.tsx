import { useState, useRef } from "react";
import { Settings, FileText, Plus, Trash2, Image, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export interface ScriptTemplate {
  id: string;
  template: string;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  voiceId: string; // For standard: en-US-Chirp3-HD-{VoiceName}, for custom: "custom"
  referenceAudioUrl?: string; // URL to reference audio for voice cloning
  isCustom?: boolean;
}

interface ConfigModalProps {
  scriptTemplates: ScriptTemplate[];
  onSaveTemplates: (templates: ScriptTemplate[]) => void;
  cartesiaVoices: CartesiaVoice[];
  onSaveVoices: (voices: CartesiaVoice[]) => void;
  imageStylePrompt: string;
  onSaveImageStylePrompt: (prompt: string) => void;
}

export function ConfigModal({ 
  scriptTemplates,
  onSaveTemplates,
  cartesiaVoices,
  onSaveVoices,
  imageStylePrompt,
  onSaveImageStylePrompt,
}: ConfigModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<ScriptTemplate[]>(scriptTemplates);
  const [voices, setVoices] = useState<CartesiaVoice[]>(cartesiaVoices);
  const [stylePrompt, setStylePrompt] = useState(imageStylePrompt);
  const [uploadingVoiceId, setUploadingVoiceId] = useState<string | null>(null);
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const handleSave = () => {
    onSaveTemplates(templates);
    onSaveVoices(voices);
    onSaveImageStylePrompt(stylePrompt);
    setIsOpen(false);
  };

  const updateTemplate = (id: string, field: keyof ScriptTemplate, value: string) => {
    setTemplates(prev => prev.map(t => 
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const addVoice = () => {
    const newVoice: CartesiaVoice = {
      id: `voice-${Date.now()}`,
      name: "",
      voiceId: "",
    };
    setVoices(prev => [...prev, newVoice]);
  };

  const updateVoice = (id: string, field: keyof CartesiaVoice, value: string | boolean | undefined) => {
    setVoices(prev => prev.map(v => 
      v.id === id ? { ...v, [field]: value } : v
    ));
  };

  const removeVoice = (id: string) => {
    setVoices(prev => prev.filter(v => v.id !== id));
  };

  const handleVoiceFileUpload = async (voiceId: string, file: File) => {
    if (!file.type.includes('audio')) {
      toast({ title: "Invalid file type", description: "Please upload a WAV or MP3 file", variant: "destructive" });
      return;
    }

    setUploadingVoiceId(voiceId);
    try {
      const fileName = `voices/${voiceId}-${Date.now()}.wav`;
      const { data, error } = await supabase.storage
        .from('generated-assets')
        .upload(fileName, file, { upsert: true });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('generated-assets')
        .getPublicUrl(fileName);

      updateVoice(voiceId, "referenceAudioUrl", urlData.publicUrl);
      updateVoice(voiceId, "isCustom", true);
      toast({ title: "Voice uploaded", description: "Reference audio uploaded successfully" });
    } catch (error) {
      console.error('Upload error:', error);
      toast({ title: "Upload failed", description: "Failed to upload voice file", variant: "destructive" });
    } finally {
      setUploadingVoiceId(null);
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

        <Tabs defaultValue="templates" className="w-full">
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
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Add standard Chirp 3 HD voices or custom cloned voices with reference audio.
              </p>
              <div className="p-3 bg-secondary/50 rounded-lg text-xs text-muted-foreground">
                <strong>Standard voices:</strong> en-US-Chirp3-HD-Puck, Fenrir, Charon, Kore, Aoede, Leda, Orus, Schedar, Zephyr<br/>
                <strong>Custom voice:</strong> Leave Voice ID empty and provide a reference audio URL
              </div>
            </div>
            
            <Button variant="outline" size="sm" onClick={addVoice} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Voice
            </Button>

            {voices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No voices added yet. Click "Add Voice" to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {voices.map((voice) => (
                  <div key={voice.id} className="flex items-start gap-3 p-4 border border-border rounded-lg">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Voice Name</Label>
                          <Input
                            value={voice.name}
                            onChange={(e) => updateVoice(voice.id, "name", e.target.value)}
                            placeholder="e.g., Sleepy Narrator"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Voice ID (leave empty for custom)</Label>
                          <Input
                            value={voice.voiceId}
                            onChange={(e) => updateVoice(voice.id, "voiceId", e.target.value)}
                            placeholder="en-US-Chirp3-HD-Puck"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Reference Audio (for voice cloning)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={voice.referenceAudioUrl || ""}
                            onChange={(e) => updateVoice(voice.id, "referenceAudioUrl", e.target.value)}
                            placeholder="Upload or paste URL"
                            className="flex-1"
                          />
                          <input
                            type="file"
                            accept="audio/*"
                            ref={(el) => (fileInputRefs.current[voice.id] = el)}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleVoiceFileUpload(voice.id, file);
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={uploadingVoiceId === voice.id}
                            onClick={() => fileInputRefs.current[voice.id]?.click()}
                          >
                            {uploadingVoiceId === voice.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Upload a WAV file (10-30 seconds) or paste a URL for voice cloning
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVoice(voice.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
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
