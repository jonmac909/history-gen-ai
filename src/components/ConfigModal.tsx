import { useState } from "react";
import { Settings, FileText, Plus, Trash2, Image } from "lucide-react";
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

export interface ScriptTemplate {
  id: string;
  template: string;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  voiceId: string;
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

  const updateVoice = (id: string, field: keyof CartesiaVoice, value: string) => {
    setVoices(prev => prev.map(v => 
      v.id === id ? { ...v, [field]: value } : v
    ));
  };

  const removeVoice = (id: string) => {
    setVoices(prev => prev.filter(v => v.id !== id));
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
            <TabsTrigger value="voices">Cartesia Voices</TabsTrigger>
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

          {/* Cartesia Voices Tab */}
          <TabsContent value="voices" className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Add your custom Cartesia voice IDs.
              </p>
              <Button variant="outline" size="sm" onClick={addVoice} className="gap-2">
                <Plus className="w-4 h-4" />
                Add Voice
              </Button>
            </div>

            {voices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No custom voices added yet. Click "Add Voice" to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {voices.map((voice) => (
                  <div key={voice.id} className="flex items-start gap-3 p-4 border border-border rounded-lg">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Voice Name</Label>
                        <Input
                          value={voice.name}
                          onChange={(e) => updateVoice(voice.id, "name", e.target.value)}
                          placeholder="e.g., British Historian"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Voice ID</Label>
                        <Input
                          value={voice.voiceId}
                          onChange={(e) => updateVoice(voice.id, "voiceId", e.target.value)}
                          placeholder="Cartesia voice ID"
                        />
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
