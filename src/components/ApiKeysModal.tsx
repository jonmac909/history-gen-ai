import { useState } from "react";
import { Key, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface ApiKeys {
  google: string;
  claude: string;
  cartesia: string;
  kie: string;
}

interface ApiKeysModalProps {
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
}

export function ApiKeysModal({ apiKeys, onSave }: ApiKeysModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>(apiKeys);
  const [showKeys, setShowKeys] = useState({
    google: false,
    claude: false,
    cartesia: false,
    kie: false,
  });

  const handleSave = () => {
    onSave(keys);
    setIsOpen(false);
  };

  const updateKey = (key: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [key]: value }));
  };

  const toggleShowKey = (key: keyof typeof showKeys) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
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
          <span className="hidden sm:inline">API Keys</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            Configure API Keys
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Keys
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}