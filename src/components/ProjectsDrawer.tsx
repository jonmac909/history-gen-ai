import { useState, useEffect } from "react";
import { FolderOpen, Trash2, Clock, Image, Music } from "lucide-react";
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
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getProjectHistory,
  removeFromProjectHistory,
  formatDuration,
  formatDate,
  type ProjectHistoryItem,
} from "@/lib/projectPersistence";

export function ProjectsDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectHistoryItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectHistoryItem | null>(null);

  // Load projects when drawer opens
  useEffect(() => {
    if (isOpen) {
      setProjects(getProjectHistory());
    }
  }, [isOpen]);

  const handleDelete = async (project: ProjectHistoryItem) => {
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

      // Remove from local history
      removeFromProjectHistory(project.id);
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

          <div className="mt-6 space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto">
            {projects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No completed projects yet</p>
                <p className="text-sm mt-1">Projects will appear here after generation</p>
              </div>
            ) : (
              projects.map(project => (
                <div
                  key={project.id}
                  className="flex items-start justify-between p-4 bg-card rounded-lg border border-border hover:border-primary/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {project.videoTitle}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(project.completedAt)}
                      </span>
                      {project.audioDuration && (
                        <span className="flex items-center gap-1">
                          <Music className="w-3 h-3" />
                          {formatDuration(project.audioDuration)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Image className="w-3 h-3" />
                        {project.imageCount}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(project)}
                    disabled={deletingId === project.id}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
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
