import { BookOpen, Calendar, MapPin, Users, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface HistoryDisplayProps {
  content: {
    title: string;
    era: string;
    location?: string;
    keyFigures?: string[];
    narrative: string;
    funFacts?: string[];
  } | null;
}

export function HistoryDisplay({ content }: HistoryDisplayProps) {
  const [copied, setCopied] = useState(false);

  if (!content) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content.narrative);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="w-full max-w-4xl mx-auto animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
      <div className="card-parchment p-8 md:p-10 relative overflow-hidden">
        {/* Decorative corner elements */}
        <div className="absolute top-0 left-0 w-16 h-16 border-l-2 border-t-2 border-gold/30 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-16 h-16 border-r-2 border-t-2 border-gold/30 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-16 h-16 border-l-2 border-b-2 border-gold/30 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-16 h-16 border-r-2 border-b-2 border-gold/30 rounded-br-lg" />

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4 leading-tight">
                {content.title}
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                {content.era && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-gold" />
                    {content.era}
                  </span>
                )}
                {content.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-gold" />
                    {content.location}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Key Figures */}
        {content.keyFigures && content.keyFigures.length > 0 && (
          <div className="mb-6 p-4 bg-secondary/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Key Figures</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {content.keyFigures.map((figure, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-background rounded-full text-sm text-muted-foreground"
                >
                  {figure}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Main Narrative */}
        <div className="prose prose-lg max-w-none">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              The Narrative
            </span>
          </div>
          <div className="text-foreground leading-relaxed whitespace-pre-wrap font-body text-base md:text-lg">
            {content.narrative}
          </div>
        </div>

        {/* Fun Facts */}
        {content.funFacts && content.funFacts.length > 0 && (
          <div className="mt-8 pt-6 border-t border-border">
            <h3 className="text-lg font-display font-semibold text-foreground mb-4">
              ✨ Fascinating Facts
            </h3>
            <ul className="space-y-2">
              {content.funFacts.map((fact, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-muted-foreground"
                >
                  <span className="text-gold mt-1">•</span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}