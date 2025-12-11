import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, History, BookOpen } from "lucide-react";

interface HistoryGeneratorProps {
  onGenerate: (prompt: string, era: string) => void;
  isLoading: boolean;
}

const eras = [
  { id: "ancient", label: "Ancient World", icon: "🏛️" },
  { id: "medieval", label: "Medieval Era", icon: "⚔️" },
  { id: "renaissance", label: "Renaissance", icon: "🎨" },
  { id: "modern", label: "Modern History", icon: "🏭" },
  { id: "any", label: "Any Era", icon: "🌍" },
];

export function HistoryGenerator({ onGenerate, isLoading }: HistoryGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedEra, setSelectedEra] = useState("any");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      onGenerate(prompt, selectedEra);
    }
  };

  const examplePrompts = [
    "The fall of the Roman Empire",
    "Daily life in ancient Egypt",
    "The invention of the printing press",
    "The rise of the Silk Road",
  ];

  return (
    <section className="w-full max-w-4xl mx-auto">
      <div className="card-parchment p-8 md:p-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <History className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-2xl md:text-3xl font-display font-semibold text-foreground">
            Generate Historical Narrative
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Era Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Select Era
            </label>
            <div className="flex flex-wrap gap-2">
              {eras.map((era) => (
                <button
                  key={era.id}
                  type="button"
                  onClick={() => setSelectedEra(era.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                    selectedEra === era.id
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  <span>{era.icon}</span>
                  <span>{era.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Input */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Your Topic or Question
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the historical topic you'd like to explore... e.g., 'The daily life of a Roman gladiator' or 'How did the Black Death change European society?'"
              className="min-h-[120px] text-base bg-parchment/50 border-border/50 focus:border-primary/50 resize-none"
            />
          </div>

          {/* Example Prompts */}
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Try these examples:
            </span>
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="text-xs px-3 py-1.5 rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="w-full md:w-auto min-w-[200px] h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate History
              </>
            )}
          </Button>
        </form>
      </div>
    </section>
  );
}