import { useState, useEffect } from "react";
import { Video, Heart, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFavoriteProjects, type Project } from "@/lib/projectStore";

interface FavoritesViewProps {
  onSelectProject: (projectId: string) => void;
  onBack?: () => void;
}

export function FavoritesView({
  onSelectProject,
  onBack,
}: FavoritesViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadProjects = async () => {
      setIsLoading(true);
      const favoriteProjects = await getFavoriteProjects();
      // Sort by updatedAt, most recent first
      favoriteProjects.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setProjects(favoriteProjects);
      setIsLoading(false);
    };
    loadProjects();
  }, []);

  // Get thumbnail for a project
  const getProjectThumbnail = (project: Project): string | null => {
    // Priority: selected thumbnail > first thumbnail > first image
    if (project.thumbnails && project.thumbnails.length > 0) {
      const selectedIdx = project.selectedThumbnailIndex ?? 0;
      return project.thumbnails[selectedIdx] || project.thumbnails[0];
    }
    if (project.imageUrls && project.imageUrls.length > 0) {
      return project.imageUrls[0];
    }
    return null;
  };

  // Get display title for a project
  const getProjectTitle = (project: Project): string => {
    return project.videoTitle || "Untitled Project";
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Heart className="w-6 h-6 text-red-500 fill-red-500" />
          <h1 className="text-2xl font-bold text-foreground">Favorites</h1>
        </div>
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 space-y-4">
          <Heart className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">No favorite projects yet</p>
          <p className="text-sm text-muted-foreground">
            Add projects to favorites from the Projects drawer
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => {
            const thumbnail = getProjectThumbnail(project);
            const title = getProjectTitle(project);

            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="group text-left rounded-xl overflow-hidden border transition-all hover:scale-[1.02] hover:shadow-lg border-border hover:border-primary/40"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-muted">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-10 h-10 text-muted-foreground opacity-30" />
                    </div>
                  )}
                  {/* Favorite indicator */}
                  <div className="absolute top-2 right-2">
                    <Heart className="w-5 h-5 text-red-500 fill-red-500" />
                  </div>
                </div>

                {/* Info */}
                <div className="p-4 space-y-1">
                  <h3 className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                    {title}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
