import { useState, useEffect } from "react";
import { FolderOpen, Trash2, Archive, Clock, Image, Music, ChevronRight, ChevronDown, PlayCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getRootProjects,
  getProjectVersions,
  deleteProject,
  archiveProject,
  getStepLabel,
  formatDuration,
  formatDate,
  type Project,
} from "@/lib/projectStore";

interface ProjectsDrawerProps {
  onOpenProject?: (project: Project) => void;
}

export function ProjectsDrawer({ onOpenProject }: ProjectsDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  // Load root projects when drawer opens (versions are loaded on-demand)
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      getRootProjects()
        .then(setProjects)
        .catch(err => console.error('[ProjectsDrawer] Failed to load projects:', err))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen]);

  const handleDelete = async (project: Project) => {
    setDeletingId(project.id);

    try {
      // Delete all files in the project folder from Supabase storage
      const { data: files, error: listError } = await supabase.storage
        .from("generated-assets")
        .list(project.id);

      if (listError) {
        console.error("Error listing files:", listError);
      } else if (files && files.length > 0) {
        const filePaths = files.map(f => `${project.id}/${f.name}`);
        const { error: deleteError } = await supabase.storage
          .from("generated-assets")
          .remove(filePaths);

        if (deleteError) {
          console.error("Error deleting files:", deleteError);
        } else {
          console.log(`Deleted ${filePaths.length} files from storage`);
        }
      }

      // Remove from project store (Supabase)
      await deleteProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));

      toast({
        title: "Project Deleted",
        description: `"${project.videoTitle}" has been removed.`,
      });
    } catch (error) {
      console.error("Error deleting project:", error);
      toast({
        title: "Delete Failed",
        description: "Could not delete project files. Try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const handleArchive = async (project: Project) => {
    setArchivingId(project.id);

    try {
      await archiveProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));

      toast({
        title: "Project Archived",
        description: `"${project.videoTitle}" has been archived.`,
      });
    } catch (error) {
      console.error("Error archiving project:", error);
      toast({
        title: "Archive Failed",
        description: "Could not archive project. Try again.",
        variant: "destructive",
      });
    } finally {
      setArchivingId(null);
    }
  };

  // Separate in-progress and completed projects
  const inProgressProjects = projects.filter(p => p.status === 'in_progress');
  const completedProjects = projects.filter(p => p.status === 'completed');

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <FolderOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Projects</span>
            {projects.length > 0 && (
              <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">
                {projects.length}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-primary" />
              Projects
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
                <p>Loading projects...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No projects yet</p>
                <p className="text-sm mt-1">Projects will appear here as you work</p>
              </div>
            ) : (
              <>
                {/* In-Progress Projects */}
                {inProgressProjects.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <PlayCircle className="w-4 h-4" />
                      In Progress ({inProgressProjects.length})
                    </div>
                    {inProgressProjects.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={onOpenProject}
                        onDelete={() => setConfirmDelete(project)}
                        onArchive={() => handleArchive(project)}
                        deletingId={deletingId}
                        archivingId={archivingId}
                        setIsOpen={setIsOpen}
                      />
                    ))}
                  </div>
                )}

                {/* Completed Projects */}
                {completedProjects.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4" />
                      Completed ({completedProjects.length})
                    </div>
                    {completedProjects.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={onOpenProject}
                        onDelete={() => setConfirmDelete(project)}
                        onArchive={() => handleArchive(project)}
                        deletingId={deletingId}
                        archivingId={archivingId}
                        setIsOpen={setIsOpen}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{confirmDelete?.videoTitle}" and all its generated files (audio, captions, images) from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Separate component for project cards with version dropdown
function ProjectCard({
  project,
  onOpen,
  onDelete,
  onArchive,
  deletingId,
  archivingId,
  setIsOpen,
}: {
  project: Project;
  onOpen?: (project: Project) => void;
  onDelete: () => void;
  onArchive: () => void;
  deletingId: string | null;
  archivingId: string | null;
  setIsOpen: (open: boolean) => void;
}) {
  const [versions, setVersions] = useState<Project[]>([]);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const isInProgress = project.status === 'in_progress';
  const imageCount = project.imageUrls?.length || 0;

  // Load versions when dropdown is opened
  const handleVersionToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isVersionsOpen && versions.length === 0) {
      setLoadingVersions(true);
      try {
        const allVersions = await getProjectVersions(project.id);
        // Filter to only show older versions (not the current one)
        setVersions(allVersions.filter(v => v.id !== project.id));
      } catch (err) {
        console.error('[ProjectCard] Failed to load versions:', err);
      } finally {
        setLoadingVersions(false);
      }
    }
    setIsVersionsOpen(!isVersionsOpen);
  };

  return (
    <div className="space-y-1">
      <div
        className="flex items-start justify-between p-4 bg-card rounded-lg border border-border hover:border-primary/30 hover:bg-accent/50 transition-colors cursor-pointer group"
        onClick={() => {
          if (onOpen) {
            onOpen(project);
            setIsOpen(false);
          }
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground truncate">
              {project.videoTitle}
            </p>
            {isInProgress && (
              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                {getStepLabel(project.currentStep)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDate(project.updatedAt)}
            </span>
            {project.audioDuration && (
              <span className="flex items-center gap-1">
                <Music className="w-3 h-3" />
                {formatDuration(project.audioDuration)}
              </span>
            )}
            {imageCount > 0 && (
              <span className="flex items-center gap-1">
                <Image className="w-3 h-3" />
                {imageCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Version dropdown toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleVersionToggle}
            title="Show previous versions"
          >
            {loadingVersions ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ChevronDown className={`w-4 h-4 transition-transform ${isVersionsOpen ? 'rotate-180' : ''}`} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            disabled={archivingId === project.id}
            title="Archive project"
          >
            <Archive className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={deletingId === project.id}
            title="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Versions dropdown */}
      {isVersionsOpen && versions.length > 0 && (
        <div className="ml-4 space-y-1">
          {versions.map(version => (
            <div
              key={version.id}
              className="flex items-center justify-between p-2 pl-3 bg-muted/50 rounded border border-border/50 hover:bg-accent/30 cursor-pointer text-sm"
              onClick={() => {
                if (onOpen) {
                  onOpen(version);
                  setIsOpen(false);
                }
              }}
            >
              <span className="text-muted-foreground">
                V{version.versionNumber} • {formatDate(version.updatedAt)}
              </span>
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}

      {/* No previous versions message */}
      {isVersionsOpen && versions.length === 0 && !loadingVersions && (
        <div className="ml-4 p-2 text-xs text-muted-foreground italic">
          No previous versions
        </div>
      )}
    </div>
  );
}
