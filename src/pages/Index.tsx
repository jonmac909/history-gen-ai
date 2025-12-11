import { useState } from "react";
import { Hero } from "@/components/Hero";
import { HistoryGenerator } from "@/components/HistoryGenerator";
import { HistoryDisplay } from "@/components/HistoryDisplay";
import { Features } from "@/components/Features";
import { Footer } from "@/components/Footer";
import { toast } from "@/hooks/use-toast";
import { Scroll } from "lucide-react";

interface HistoryContent {
  title: string;
  era: string;
  location?: string;
  keyFigures?: string[];
  narrative: string;
  funFacts?: string[];
}

// Mock history content generator (simulates AI response)
const generateMockHistory = (prompt: string, era: string): HistoryContent => {
  const eraLabels: Record<string, string> = {
    ancient: "Ancient World (3000 BCE - 500 CE)",
    medieval: "Medieval Era (500 - 1500 CE)",
    renaissance: "Renaissance Period (1400 - 1600 CE)",
    modern: "Modern Era (1800 - Present)",
    any: "Throughout History",
  };

  // Generate contextual content based on prompt
  const topics: Record<string, HistoryContent> = {
    default: {
      title: prompt.charAt(0).toUpperCase() + prompt.slice(1),
      era: eraLabels[era] || "Throughout History",
      location: "Various regions across the globe",
      keyFigures: ["Notable leaders", "Influential thinkers", "Cultural pioneers"],
      narrative: `The topic of "${prompt}" represents one of history's most fascinating subjects. Throughout the ages, this subject has shaped civilizations, influenced cultures, and left an indelible mark on human development.

In examining ${prompt}, we discover layers of complexity that reveal both the triumphs and struggles of our ancestors. The historical record shows us that people across different eras grappled with similar challenges, adapting their approaches based on the resources and knowledge available to them.

The significance of this topic extends beyond mere historical curiosity. It offers us valuable insights into human nature, social organization, and the forces that drive change. Scholars have long debated the various interpretations and implications, each bringing new perspectives to our understanding.

What makes this subject particularly compelling is how it connects disparate events and places, creating a narrative thread that weaves through centuries of human experience. From the earliest recorded instances to its modern manifestations, we see an evolution that reflects broader changes in society, technology, and thought.

As we explore this topic further, we gain not only knowledge of the past but also wisdom applicable to our present circumstances. History, after all, serves as both a mirror and a guide, showing us who we were and suggesting possibilities for who we might become.`,
      funFacts: [
        "Historical records show surprising connections between seemingly unrelated events",
        "Many modern practices have roots stretching back thousands of years",
        "Archaeological discoveries continue to reshape our understanding of this topic",
        "Different cultures developed remarkably similar approaches independently",
      ],
    },
    "roman": {
      title: "The Glory and Fall of Rome",
      era: "Ancient World (753 BCE - 476 CE)",
      location: "Mediterranean Basin, Europe, Near East",
      keyFigures: ["Julius Caesar", "Augustus", "Marcus Aurelius", "Constantine I"],
      narrative: `The Roman Empire stands as one of history's most remarkable civilizations, its influence still felt in our laws, languages, architecture, and governance systems today.

Beginning as a small city-state on the Italian peninsula around 753 BCE, Rome grew to control vast territories spanning three continents. At its height under Emperor Trajan (117 CE), the Empire stretched from Britain to Mesopotamia, encompassing some 5 million square kilometers and 70 million people.

The Romans were master builders and administrators. They constructed roads, aqueducts, and public buildings that have survived millennia. The Roman legal system formed the foundation for many modern legal codes. Latin, the language of Rome, evolved into the Romance languages and contributed vast vocabulary to English and other tongues.

Yet the Empire's very success contained the seeds of its decline. Overextension, economic troubles, political instability, and pressure from migrating peoples all contributed to its gradual weakening. The western half of the Empire fell in 476 CE when the Germanic leader Odoacer deposed the last Roman emperor, Romulus Augustulus.

The Eastern Roman Empire, known as Byzantium, would survive another thousand years, preserving Roman traditions and serving as a bridge between ancient and modern worlds. The legacy of Rome remains fundamental to Western civilization and continues to shape our world today.`,
      funFacts: [
        "Roman concrete was so durable that structures like the Pantheon still stand today",
        "At its peak, Rome had over a million inhabitants—a population not matched again until 19th century London",
        "Romans invented central heating systems called hypocausts",
        "The phrase 'All roads lead to Rome' was literally true—they built 50,000 miles of roads",
      ],
    },
    "egypt": {
      title: "Daily Life in Ancient Egypt",
      era: "Ancient World (3100 BCE - 30 BCE)",
      location: "Nile River Valley, Northeastern Africa",
      keyFigures: ["Pharaohs", "Scribes", "Priests", "Artisans", "Farmers"],
      narrative: `Ancient Egyptian civilization flourished along the Nile River for over three millennia, creating one of the most stable and enduring cultures in human history. The daily life of its inhabitants was shaped by the river's annual floods, religious beliefs, and a highly organized social structure.

For most Egyptians, life centered around agriculture. The Nile's yearly inundation deposited rich soil along its banks, creating fertile farmland in an otherwise desert landscape. Farmers grew wheat, barley, flax, and vegetables, raising cattle and other livestock. When floods made fieldwork impossible, many labored on royal building projects.

Egyptian homes varied by social class. Wealthy families lived in spacious villas with gardens and pools, while common people dwelt in simple mud-brick houses. Despite these differences, family life was valued across all levels of society. Women enjoyed relatively high status for the ancient world, able to own property, conduct business, and initiate divorce.

Religion permeated every aspect of daily life. Egyptians believed in numerous gods, performed rituals, and prepared extensively for the afterlife. The elaborate mummification process and construction of tombs reflected their belief that proper burial ensured eternal existence.

The Egyptians were remarkably innovative, developing hieroglyphic writing, advanced mathematics, sophisticated medicine, and engineering techniques that still inspire wonder. Their legacy endures in monuments like the pyramids and temples, and in the profound influence they exerted on later civilizations.`,
      funFacts: [
        "Egyptians of both sexes wore makeup, believing it had healing and protective powers",
        "They domesticated cats, initially to protect grain stores from mice",
        "Beer was a staple beverage, consumed by adults and children alike",
        "Egyptian physicians performed surgeries and used over 700 remedies from plants and minerals",
      ],
    },
  };

  // Match prompt to relevant content
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes("roman") || lowerPrompt.includes("rome") || lowerPrompt.includes("gladiator")) {
    return topics["roman"];
  } else if (lowerPrompt.includes("egypt") || lowerPrompt.includes("pharaoh") || lowerPrompt.includes("pyramid") || lowerPrompt.includes("nile")) {
    return topics["egypt"];
  }
  
  return topics["default"];
};

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [historyContent, setHistoryContent] = useState<HistoryContent | null>(null);

  const handleGenerate = async (prompt: string, era: string) => {
    setIsLoading(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const content = generateMockHistory(prompt, era);
      setHistoryContent(content);
      toast({
        title: "History Generated!",
        description: `Your narrative about "${prompt}" is ready.`,
      });
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scroll className="w-6 h-6 text-gold" />
            <span className="font-display text-xl font-semibold text-foreground">
              HistoryGen AI
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#generator" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Generate
            </a>
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <Hero />

      {/* Main Generator Section */}
      <main id="generator" className="py-20 px-4">
        <div className="container mx-auto space-y-12">
          <HistoryGenerator onGenerate={handleGenerate} isLoading={isLoading} />
          
          {historyContent && (
            <HistoryDisplay content={historyContent} />
          )}
        </div>
      </main>

      {/* Features Section */}
      <div id="features">
        <Features />
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default Index;