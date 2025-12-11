import { useState } from "react";
import { Key, Eye, EyeOff, FileText, Plus, Trash2 } from "lucide-react";
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

export interface ApiKeys {
  google: string;
  claude: string;
  cartesia: string;
  kie: string;
}

export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  voiceId: string;
}

interface ApiKeysModalProps {
  apiKeys: ApiKeys;
  onSaveApiKeys: (keys: ApiKeys) => void;
  scriptTemplates: ScriptTemplate[];
  onSaveTemplates: (templates: ScriptTemplate[]) => void;
  cartesiaVoices: CartesiaVoice[];
  onSaveVoices: (voices: CartesiaVoice[]) => void;
}

export function ApiKeysModal({ 
  apiKeys, 
  onSaveApiKeys,
  scriptTemplates,
  onSaveTemplates,
  cartesiaVoices,
  onSaveVoices,
}: ApiKeysModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>(apiKeys);
  const [templates, setTemplates] = useState<ScriptTemplate[]>(scriptTemplates);
  const [voices, setVoices] = useState<CartesiaVoice[]>(cartesiaVoices);
  const [showKeys, setShowKeys] = useState({
    google: false,
    claude: false,
    cartesia: false,
    kie: false,
  });

  const handleSave = () => {
    onSaveApiKeys(keys);
    onSaveTemplates(templates);
    onSaveVoices(voices);
    setIsOpen(false);
  };

  const updateKey = (key: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [key]: value }));
  };

  const toggleShowKey = (key: keyof typeof showKeys) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
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

  const keyFields: { id: keyof ApiKeys; label: string }[] = [
    { id: "google", label: "Google API Key" },
    { id: "claude", label: "Claude API Key" },
    { id: "cartesia", label: "Cartesia API Key" },
    { id: "kie", label: "Kie.ai API Key" },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <Key className="w-4 h-4" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            Configuration
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="api-keys" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="templates">Script Templates</TabsTrigger>
            <TabsTrigger value="voices">Cartesia Voices</TabsTrigger>
          </TabsList>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-4 py-4">
            {keyFields.map((field) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.id}>{field.label}</Label>
                <div className="relative">
                  <Input
                    id={field.id}
                    type={showKeys[field.id] ? "text" : "password"}
                    value={keys[field.id]}
                    onChange={(e) => updateKey(field.id, e.target.value)}
                    placeholder={`Enter your ${field.label}...`}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey(field.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKeys[field.id] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </TabsContent>

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
                  <Label>Template Name</Label>
                  <Input
                    value={template.name}
                    onChange={(e) => updateTemplate(template.id, "name", e.target.value)}
                    placeholder="e.g., Dramatic Storytelling"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={template.description}
                    onChange={(e) => updateTemplate(template.id, "description", e.target.value)}
                    placeholder="e.g., Focus on narrative arc and suspense"
                  />
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