import type { GenerationSettings } from "@/components/SettingsPopover";
import type { ImagePromptWithTiming, AudioSegment } from "@/lib/api";

export interface SavedProject {
  id: string;
  savedAt: number;
  sourceUrl: string;
  videoTitle: string;
  settings: GenerationSettings;

  // Pipeline progress
  step: "script" | "audio" | "captions" | "prompts" | "images" | "complete";

  // Generated content
  script?: string;
  audioUrl?: string;
  audioDuration?: number;
  audioSegments?: AudioSegment[];
  srtContent?: string;
  srtUrl?: string;
  imagePrompts?: ImagePromptWithTiming[];
  imageUrls?: string[];
}

const STORAGE_KEY = "historygenai-saved-project";

export function saveProject(project: SavedProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    console.log(`Project saved at step: ${project.step}`);
  } catch (error) {
    console.error("Failed to save project:", error);
  }
}

export function loadProject(): SavedProject | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const project = JSON.parse(saved) as SavedProject;

    // Check if project is older than 24 hours
    const hoursSinceLastSave = (Date.now() - project.savedAt) / (1000 * 60 * 60);
    if (hoursSinceLastSave > 24) {
      console.log("Saved project expired (>24 hours old)");
      clearProject();
      return null;
    }

    return project;
  } catch (error) {
    console.error("Failed to load project:", error);
    return null;
  }
}

export function clearProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log("Saved project cleared");
  } catch (error) {
    console.error("Failed to clear project:", error);
  }
}

export function getStepLabel(step: SavedProject["step"]): string {
  switch (step) {
    case "script": return "Script Ready";
    case "audio": return "Audio Ready";
    case "captions": return "Captions Ready";
    case "prompts": return "Image Prompts Ready";
    case "images": return "Images Ready";
    case "complete": return "Complete";
    default: return "In Progress";
  }
}
