import { Scroll } from "lucide-react";

export function Footer() {
  return (
    <footer className="py-12 border-t border-border bg-card/50">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Scroll className="w-6 h-6 text-gold" />
            <span className="font-display text-xl font-semibold text-foreground">
              HistoryGen AI
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground text-center">
            Bringing history to life through the power of artificial intelligence.
          </p>

          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} HistoryGen
          </div>
        </div>
      </div>
    </footer>
  );
}