import heroImage from "@/assets/hero-history.jpg";
import { Scroll, Sparkles } from "lucide-react";

export function Hero() {
  return (
    <section className="relative min-h-[60vh] md:min-h-[70vh] flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src={heroImage}
          alt="Historical scenes collage"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/70 to-background" />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 text-center">
        <div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold/20 backdrop-blur-sm border border-gold/30 mb-6">
            <Sparkles className="w-4 h-4 text-gold" />
            <span className="text-sm font-medium text-gold">AI-Powered History</span>
          </div>
        </div>

        <h1 
          className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-primary-foreground mb-6 leading-tight animate-fade-in-up"
          style={{ animationDelay: "0.2s" }}
        >
          Uncover the Past with
          <span className="block text-gold">HistoryGen AI</span>
        </h1>

        <p 
          className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto mb-8 font-body animate-fade-in-up"
          style={{ animationDelay: "0.3s" }}
        >
          Transform any historical topic into rich, engaging narratives. 
          From ancient civilizations to modern revolutions — explore history like never before.
        </p>

        <div 
          className="animate-fade-in-up flex justify-center"
          style={{ animationDelay: "0.4s" }}
        >
          <a
            href="#generator"
            className="inline-flex items-center gap-2 px-8 py-4 bg-gold text-ink font-semibold rounded-lg hover:brightness-110 transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            <Scroll className="w-5 h-5" />
            Start Exploring
          </a>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 rounded-full border-2 border-primary-foreground/30 flex items-start justify-center p-2">
          <div className="w-1.5 h-2.5 bg-primary-foreground/50 rounded-full" />
        </div>
      </div>
    </section>
  );
}