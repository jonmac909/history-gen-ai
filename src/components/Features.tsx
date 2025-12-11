import { Brain, Clock, Globe, Lightbulb, Shield, Zap } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Research",
    description: "Advanced language models synthesize historical data into coherent narratives.",
  },
  {
    icon: Globe,
    title: "Global Coverage",
    description: "Explore history from every corner of the world, from ancient to modern times.",
  },
  {
    icon: Clock,
    title: "Era Selection",
    description: "Focus on specific time periods or let AI blend insights across ages.",
  },
  {
    icon: Lightbulb,
    title: "Engaging Insights",
    description: "Discover fascinating facts and lesser-known stories from history.",
  },
  {
    icon: Zap,
    title: "Instant Generation",
    description: "Get detailed historical narratives in seconds, not hours of research.",
  },
  {
    icon: Shield,
    title: "Accurate & Sourced",
    description: "Content grounded in historical research and scholarly understanding.",
  },
];

export function Features() {
  return (
    <section className="py-20 bg-secondary/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
            Why Choose HistoryGen?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Powered by cutting-edge AI, designed for history enthusiasts, students, and curious minds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => (
            <div
              key={feature.title}
              className="p-6 bg-card rounded-xl border border-border hover:border-gold/30 transition-all duration-300 hover:shadow-lg group"
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-gold/20 transition-colors">
                <feature.icon className="w-6 h-6 text-primary group-hover:text-gold transition-colors" />
              </div>
              <h3 className="text-lg font-display font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}