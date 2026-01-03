import type { GenerationSettings } from "@/components/SettingsPopover";
import type { ImagePromptWithTiming, AudioSegment } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

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

  // Thumbnails
  thumbnails?: string[];  // Array of generated thumbnail URLs
  selectedThumbnailIndex?: number;  // Index of selected thumbnail for YouTube upload
}

// Legacy localStorage keys for migration
const LEGACY_PROJECTS_KEY = "historygenai-projects-v2";
const LEGACY_SAVED_KEY = "historygenai-saved-project";
const LEGACY_HISTORY_KEY = "historygenai-project-history";
const SUPABASE_MIGRATION_KEY = "historygenai-supabase-migration-done";

// Convert database row to Project interface
function rowToProject(row: {
  id: string;
  source_url: string;
  source_type: string;
  status: string;
  video_title: string | null;
  current_step: string | null;
  script_content: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  audio_segments: unknown;
  srt_url: string | null;
  srt_content: string | null;
  image_prompts: unknown;
  image_urls: unknown;
  video_url: string | null;
  video_url_captioned: string | null;
  embers_video_url: string | null;
  smoke_embers_video_url: string | null;
  settings: unknown;
  thumbnails: unknown;
  selected_thumbnail_index: number | null;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    videoTitle: row.video_title || 'Untitled',
    sourceUrl: row.source_url,
    settings: (row.settings as GenerationSettings) || {} as GenerationSettings,
    status: (row.status as Project['status']) || 'in_progress',
    currentStep: (row.current_step as Project['currentStep']) || 'script',
    script: row.script_content || undefined,
    audioUrl: row.audio_url || undefined,
    audioDuration: row.audio_duration || undefined,
    audioSegments: (row.audio_segments as AudioSegment[]) || undefined,
    srtContent: row.srt_content || undefined,
    srtUrl: row.srt_url || undefined,
    imagePrompts: (row.image_prompts as ImagePromptWithTiming[]) || undefined,
    imageUrls: (row.image_urls as string[]) || undefined,
    videoUrl: row.video_url || undefined,
    videoUrlCaptioned: row.video_url_captioned || undefined,
    embersVideoUrl: row.embers_video_url || undefined,
    smokeEmbersVideoUrl: row.smoke_embers_video_url || undefined,
    thumbnails: (row.thumbnails as string[]) || undefined,
    selectedThumbnailIndex: row.selected_thumbnail_index ?? undefined,
  };
}

// Convert Project to database row format
function projectToRow(project: Partial<Project> & { id: string }, isNew: boolean = false) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id: project.id,
    source_url: project.sourceUrl || '',
    source_type: 'youtube',
    status: project.status || 'in_progress',
    video_title: project.videoTitle || null,
    current_step: project.currentStep || 'script',
    script_content: project.script || null,
    audio_url: project.audioUrl || null,
    audio_duration: project.audioDuration || null,
    audio_segments: project.audioSegments || [],
    srt_url: project.srtUrl || null,
    srt_content: project.srtContent || null,
    image_prompts: project.imagePrompts || [],
    image_urls: project.imageUrls || [],
    video_url: project.videoUrl || null,
    video_url_captioned: project.videoUrlCaptioned || null,
    embers_video_url: project.embersVideoUrl || null,
    smoke_embers_video_url: project.smokeEmbersVideoUrl || null,
    settings: project.settings || null,
    thumbnails: project.thumbnails || [],
    selected_thumbnail_index: project.selectedThumbnailIndex ?? null,
    updated_at: now,
  };

  // Only set created_at for new projects
  if (isNew) {
    row.created_at = now;
  }

  return row;
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('generation_projects')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    console.error('[projectStore] Error fetching project:', error);
    return null;
  }

  return rowToProject(data);
}

export async function getAllProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('generation_projects')
    .select('*')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[projectStore] Error fetching projects:', error);
    return [];
  }

  return (data || []).map(rowToProject);
}

export async function upsertProject(project: Partial<Project> & { id: string }): Promise<Project> {
  // Check if project exists to determine if this is a new insert
  const { data: existing } = await supabase
    .from('generation_projects')
    .select('id')
    .eq('id', project.id)
    .single();

  const isNew = !existing;
  const row = projectToRow(project, isNew);

  const { data, error } = await supabase
    .from('generation_projects')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('[projectStore] Error upserting project:', error);
    throw error;
  }

  console.log(`[projectStore] ${isNew ? 'Created' : 'Updated'} project: ${project.id}`, {
    status: project.status,
    step: project.currentStep
  });

  return rowToProject(data);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('generation_projects')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[projectStore] Error deleting project:', error);
    throw error;
  }

  console.log(`[projectStore] Deleted project: ${id}`);
}

export async function archiveProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('generation_projects')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[projectStore] Error archiving project:', error);
    throw error;
  }

  console.log(`[projectStore] Archived project: ${id}`);
}

export async function getInProgressProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('generation_projects')
    .select('*')
    .eq('status', 'in_progress')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[projectStore] Error fetching in-progress projects:', error);
    return [];
  }

  return (data || []).map(rowToProject);
}

export async function getCompletedProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('generation_projects')
    .select('*')
    .eq('status', 'completed')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[projectStore] Error fetching completed projects:', error);
    return [];
  }

  return (data || []).map(rowToProject);
}

export async function getMostRecentInProgress(): Promise<Project | null> {
  const now = Date.now();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('generation_projects')
    .select('*')
    .eq('status', 'in_progress')
    .gte('updated_at', twentyFourHoursAgo)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    // No recent in-progress project found - not an error
    return null;
  }

  return rowToProject(data);
}

export async function completeProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('generation_projects')
    .update({
      status: 'completed',
      current_step: 'complete',
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    console.error('[projectStore] Error completing project:', error);
    throw error;
  }

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

// Migration from localStorage to Supabase (runs once)
export async function migrateFromLocalStorage(): Promise<void> {
  // Check if migration already done
  const migrationDone = localStorage.getItem(SUPABASE_MIGRATION_KEY);
  if (migrationDone) {
    console.log("[projectStore] Supabase migration already completed");
    return;
  }

  console.log("[projectStore] Starting migration from localStorage to Supabase...");

  // Try to migrate from new unified storage first
  const projectsRaw = localStorage.getItem(LEGACY_PROJECTS_KEY);
  if (projectsRaw) {
    try {
      const projects: Project[] = JSON.parse(projectsRaw);
      console.log(`[projectStore] Migrating ${projects.length} projects from localStorage`);

      for (const project of projects) {
        try {
          await upsertProject(project);
          console.log(`[projectStore] Migrated project: ${project.id} - ${project.videoTitle}`);
        } catch (err) {
          console.error(`[projectStore] Failed to migrate project ${project.id}:`, err);
        }
      }
    } catch (e) {
      console.error('[projectStore] Failed to parse localStorage projects:', e);
    }
  }

  // Also try legacy storage formats
  const savedRaw = localStorage.getItem(LEGACY_SAVED_KEY);
  if (savedRaw) {
    try {
      const saved = JSON.parse(savedRaw);
      console.log("[projectStore] Migrating legacy saved project:", saved.id);
      await upsertProject({
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
      console.error('[projectStore] Failed to migrate legacy saved project:', e);
    }
  }

  const historyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
  if (historyRaw) {
    try {
      const history = JSON.parse(historyRaw);
      console.log(`[projectStore] Migrating ${history.length} legacy history projects`);
      for (const item of history) {
        try {
          await upsertProject({
            id: item.id,
            createdAt: item.completedAt,
            updatedAt: item.completedAt,
            videoTitle: item.videoTitle || 'Untitled',
            sourceUrl: item.videoTitle || '',
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
        } catch (err) {
          console.error(`[projectStore] Failed to migrate history item ${item.id}:`, err);
        }
      }
    } catch (e) {
      console.error('[projectStore] Failed to migrate legacy history:', e);
    }
  }

  // Mark migration as done
  localStorage.setItem(SUPABASE_MIGRATION_KEY, 'true');

  // Clear localStorage after successful migration
  localStorage.removeItem(LEGACY_PROJECTS_KEY);
  localStorage.removeItem(LEGACY_SAVED_KEY);
  localStorage.removeItem(LEGACY_HISTORY_KEY);

  console.log("[projectStore] Migration to Supabase complete");
}
