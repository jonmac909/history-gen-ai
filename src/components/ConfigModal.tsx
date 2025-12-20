import { useState } from "react";
import { Settings, FileText, Image } from "lucide-react";
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="templates">Script Templates</TabsTrigger>
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
