import type { GenerationSettings } from "@/components/SettingsPopover";
import type { ImagePromptWithTiming, AudioSegment } from "@/lib/api";

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  videoTitle: string;
  sourceUrl: string;
  settings: GenerationSettings;

  // Status replaces the old dual-storage system
  status: 'in_progress' | 'completed' | 'archived';
  currentStep: 'script' | 'audio' | 'captions' | 'prompts' | 'images' | 'complete';

  // All assets (populated as generated)
  script?: string;
  audioUrl?: string;
  audioDuration?: number;
  audioSegments?: AudioSegment[];
  srtContent?: string;
  srtUrl?: string;
  imagePrompts?: ImagePromptWithTiming[];
  imageUrls?: string[];
  videoUrl?: string;
  videoUrlCaptioned?: string;
  embersVideoUrl?: string;
  smokeEmbersVideoUrl?: string;
}

const PROJECTS_KEY = "historygenai-projects-v2";
const MIGRATION_KEY = "historygenai-migration-v2-done";

// Legacy keys for migration
const LEGACY_SAVED_KEY = "historygenai-saved-project";
const LEGACY_HISTORY_KEY = "historygenai-project-history";

function loadAllProjects(): Project[] {
  try {
    const data = localStorage.getItem(PROJECTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Failed to load projects:", error);
    return [];
  }
}

function saveAllProjects(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error("Failed to save projects:", error);
  }
}

export function getProject(id: string): Project | null {
  return loadAllProjects().find(p => p.id === id) || null;
}

export function getAllProjects(): Project[] {
  return loadAllProjects().filter(p => p.status !== 'archived');
}

export function upsertProject(project: Partial<Project> & { id: string }): Project {
  const projects = loadAllProjects();
  const existingIndex = projects.findIndex(p => p.id === project.id);

  const now = Date.now();
  let finalProject: Project;

  if (existingIndex >= 0) {
    // Update existing project
    finalProject = {
      ...projects[existingIndex],
      ...project,
      updatedAt: now
    };
    projects[existingIndex] = finalProject;
    console.log(`[projectStore] Updated project: ${project.id}`, {
      status: finalProject.status,
      step: finalProject.currentStep
    });
  } else {
    // Create new project
    finalProject = {
      createdAt: now,
      updatedAt: now,
      status: 'in_progress',
      currentStep: 'script',
      videoTitle: 'Untitled',
      sourceUrl: '',
      settings: {} as GenerationSettings,
      ...project,
    } as Project;
    projects.unshift(finalProject);
    console.log(`[projectStore] Created project: ${project.id}`, {
      status: finalProject.status,
      step: finalProject.currentStep
    });
  }

  // Keep only last 100 projects to prevent localStorage bloat
  const trimmed = projects.slice(0, 100);
  saveAllProjects(trimmed);
  return finalProject;
}

export function deleteProject(id: string): void {
  const projects = loadAllProjects().filter(p => p.id !== id);
  saveAllProjects(projects);
  console.log(`[projectStore] Deleted project: ${id}`);
}

export function archiveProject(id: string): void {
  upsertProject({ id, status: 'archived' });
  console.log(`[projectStore] Archived project: ${id}`);
}

export function getInProgressProjects(): Project[] {
  return loadAllProjects()
    .filter(p => p.status === 'in_progress')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCompletedProjects(): Project[] {
  return loadAllProjects()
    .filter(p => p.status === 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMostRecentInProgress(): Project | null {
  const inProgress = getInProgressProjects();

  // Filter out projects older than 24 hours
  const now = Date.now();
  const validProjects = inProgress.filter(p => {
    const hoursSinceUpdate = (now - p.updatedAt) / (1000 * 60 * 60);
    return hoursSinceUpdate <= 24;
  });

  return validProjects[0] || null;
}

export function completeProject(id: string): void {
  upsertProject({ id, status: 'completed', currentStep: 'complete' });
  console.log(`[projectStore] Completed project: ${id}`);
}

export function getStepLabel(step: Project["currentStep"]): string {
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

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// Migration from legacy storage (SavedProject + ProjectHistoryItem)
export function migrateFromLegacyStorage(): void {
  const migrationDone = localStorage.getItem(MIGRATION_KEY);
  if (migrationDone) {
    console.log("[projectStore] Migration already completed");
    return;
  }

  console.log("[projectStore] Starting migration from legacy storage...");
  const projects: Project[] = [];

  // Migrate saved project (in-progress)
  const savedRaw = localStorage.getItem(LEGACY_SAVED_KEY);
  if (savedRaw) {
    try {
      const saved = JSON.parse(savedRaw);
      console.log("[projectStore] Migrating in-progress project:", saved.id);
      projects.push({
        id: saved.id,
        createdAt: saved.savedAt,
        updatedAt: saved.savedAt,
        videoTitle: saved.videoTitle || 'Untitled',
        sourceUrl: saved.sourceUrl || '',
        settings: saved.settings || {} as GenerationSettings,
        status: 'in_progress',
        currentStep: saved.step || 'script',
        script: saved.script,
        audioUrl: saved.audioUrl,
        audioDuration: saved.audioDuration,
        audioSegments: saved.audioSegments,
        srtContent: saved.srtContent,
        srtUrl: saved.srtUrl,
        imagePrompts: saved.imagePrompts,
        imageUrls: saved.imageUrls,
        videoUrl: saved.videoUrl,
        videoUrlCaptioned: saved.videoUrlCaptioned,
        embersVideoUrl: saved.embersVideoUrl,
        smokeEmbersVideoUrl: saved.smokeEmbersVideoUrl,
      });
    } catch (e) {
      console.error('[projectStore] Failed to migrate saved project:', e);
    }
  }

  // Migrate history (completed projects)
  const historyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
  if (historyRaw) {
    try {
      const history = JSON.parse(historyRaw);
      console.log(`[projectStore] Migrating ${history.length} completed projects`);
      for (const item of history) {
        // Skip if already migrated from saved project
        if (projects.some(p => p.id === item.id)) {
          console.log(`[projectStore] Skipping duplicate: ${item.id}`);
          continue;
        }

        projects.push({
          id: item.id,
          createdAt: item.completedAt,
          updatedAt: item.completedAt,
          videoTitle: item.videoTitle || 'Untitled',
          sourceUrl: item.videoTitle || '', // History didn't store sourceUrl
          settings: {} as GenerationSettings,
          status: 'completed',
          currentStep: 'complete',
          script: item.script,
          audioUrl: item.audioUrl,
          audioDuration: item.audioDuration,
          srtContent: item.srtContent,
          srtUrl: item.srtUrl,
          imagePrompts: item.imagePrompts,
          imageUrls: item.imageUrls,
          videoUrl: item.videoUrl,
          videoUrlCaptioned: item.videoUrlCaptioned,
          embersVideoUrl: item.embersVideoUrl,
          smokeEmbersVideoUrl: item.smokeEmbersVideoUrl,
        });
      }
    } catch (e) {
      console.error('[projectStore] Failed to migrate history:', e);
    }
  }

  if (projects.length > 0) {
    saveAllProjects(projects);
    console.log(`[projectStore] Migration complete: ${projects.length} projects migrated`);
  } else {
    console.log("[projectStore] No legacy projects to migrate");
  }

  // Mark migration as done
  localStorage.setItem(MIGRATION_KEY, 'true');

  // Clean up legacy keys (optional - keep for safety during rollout)
  // localStorage.removeItem(LEGACY_SAVED_KEY);
  // localStorage.removeItem(LEGACY_HISTORY_KEY);
}
