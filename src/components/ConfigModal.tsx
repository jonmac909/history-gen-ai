import { useState } from "react";
import { Settings, FileText, Image, Volume2 } from "lucide-react";
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
  name?: string;
}

export interface FormatTemplate {
  id: string;
  template: string;
  name?: string;
}

export interface ImageTemplate {
  id: string;
  template: string;
  name?: string;
}

// Alias for backward compatibility
export type ToneTemplate = FormatTemplate;

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
  formatTemplates: FormatTemplate[];
  onSaveFormatTemplates: (templates: FormatTemplate[]) => void;
  scriptTemplates: FormatTemplate[];
  onSaveScriptTemplates: (templates: FormatTemplate[]) => void;
  imageTemplates: ImageTemplate[];
  onSaveImageTemplates: (templates: ImageTemplate[]) => void;
  cartesiaVoices: CartesiaVoice[];
  onSaveVoices: (voices: CartesiaVoice[]) => void;
}

export function ConfigModal({
  formatTemplates,
  onSaveFormatTemplates,
  scriptTemplates,
  onSaveScriptTemplates,
  imageTemplates,
  onSaveImageTemplates,
  cartesiaVoices,
  onSaveVoices,
}: ConfigModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [formats, setFormats] = useState<FormatTemplate[]>(formatTemplates);
  const [scripts, setScripts] = useState<FormatTemplate[]>(scriptTemplates);
  const [images, setImages] = useState<ImageTemplate[]>(imageTemplates);
  const [voices, setVoices] = useState<CartesiaVoice[]>(cartesiaVoices);

  const handleSave = () => {
    onSaveFormatTemplates(formats);
    onSaveScriptTemplates(scripts);
    onSaveImageTemplates(images);
    onSaveVoices(voices);
    setIsOpen(false);
  };

  const updateFormatTemplate = (id: string, field: keyof FormatTemplate, value: string) => {
    setFormats(prev => prev.map(t =>
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const updateScriptTemplate = (id: string, field: keyof FormatTemplate, value: string) => {
    setScripts(prev => prev.map(t =>
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const updateImageTemplate = (id: string, field: keyof ImageTemplate, value: string) => {
    setImages(prev => prev.map(t =>
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
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Configuration
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="format" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="format">Format</TabsTrigger>
            <TabsTrigger value="script">Script</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
          </TabsList>

          {/* Format Templates Tab */}
          <TabsContent value="format" className="space-y-6 py-4">
            <p className="text-sm text-muted-foreground">
              Configure format templates to define the structure of your scripts.
            </p>

            {formats.map((format, index) => {
              const defaultName = `Format ${String.fromCharCode(65 + index)}`;
              return (
                <div key={format.id} className="space-y-3 p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="font-medium">{format.name || defaultName}</span>
                  </div>

                  <div className="space-y-2">
                    <Label>Format Name</Label>
                    <Input
                      value={format.name || ""}
                      onChange={(e) => updateFormatTemplate(format.id, "name", e.target.value)}
                      placeholder={defaultName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Format Description</Label>
                    <Textarea
                      value={format.template}
                      onChange={(e) => updateFormatTemplate(format.id, "template", e.target.value)}
                      placeholder="Describe the structure and format..."
                      className="min-h-[150px]"
                    />
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* Script Templates Tab */}
          <TabsContent value="script" className="space-y-6 py-4">
            <p className="text-sm text-muted-foreground">
              Configure script templates to define the voice and approach for narration.
            </p>

            {scripts.map((script, index) => {
              const defaultName = `Script ${String.fromCharCode(65 + index)}`;
              return (
                <div key={script.id} className="space-y-3 p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-primary" />
                    <span className="font-medium">{script.name || defaultName}</span>
                  </div>

                  <div className="space-y-2">
                    <Label>Script Name</Label>
                    <Input
                      value={script.name || ""}
                      onChange={(e) => updateScriptTemplate(script.id, "name", e.target.value)}
                      placeholder={defaultName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Script Description</Label>
                    <Textarea
                      value={script.template}
                      onChange={(e) => updateScriptTemplate(script.id, "template", e.target.value)}
                      placeholder="Describe the voice, approach, and techniques..."
                      className="min-h-[100px]"
                    />
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* Image Templates Tab */}
          <TabsContent value="image" className="space-y-6 py-4">
            <p className="text-sm text-muted-foreground">
              Configure image templates to define the visual style for generated images.
            </p>

            {images.map((template, index) => {
              const defaultName = `Image Style ${String.fromCharCode(65 + index)}`;
              return (
                <div key={template.id} className="space-y-3 p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-2">
                    <Image className="w-4 h-4 text-primary" />
                    <span className="font-medium">{template.name || defaultName}</span>
                  </div>

                  <div className="space-y-2">
                    <Label>Template Name</Label>
                    <Input
                      value={template.name || ""}
                      onChange={(e) => updateImageTemplate(template.id, "name", e.target.value)}
                      placeholder={defaultName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Style Prompt</Label>
                    <Textarea
                      value={template.template}
                      onChange={(e) => updateImageTemplate(template.id, "template", e.target.value)}
                      placeholder="e.g., Cinematic, dramatic lighting, 4K quality, photorealistic..."
                      className="min-h-[150px]"
                    />
                  </div>
                </div>
              );
            })}
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
