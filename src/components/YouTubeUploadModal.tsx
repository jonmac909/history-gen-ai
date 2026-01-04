import { useState, useEffect } from "react";
import {
  Youtube,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  X
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  checkYouTubeConnection,
  fetchYouTubeChannels,
  fetchYouTubePlaylists,
  disconnectYouTube,
  authenticateYouTube,
  type YouTubeChannel,
  type YouTubePlaylist,
} from "@/lib/youtubeAuth";
import { generateYouTubeMetadata } from "@/lib/api";

interface YouTubeUploadModalProps {
  isOpen: boolean;
  projectTitle?: string;
  script?: string;
  onClose: () => void;
  onConfirm?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onMetadataChange?: (title: string, description: string, tags: string, categoryId: string, playlistId: string | null) => void;
  initialTitle?: string;
  initialDescription?: string;
  initialTags?: string;
  initialCategoryId?: string;
  initialPlaylistId?: string | null;
}

const CATEGORIES = [
  { id: "27", name: "Education" },
  { id: "22", name: "People & Blogs" },
  { id: "24", name: "Entertainment" },
  { id: "25", name: "News & Politics" },
  { id: "28", name: "Science & Technology" },
  { id: "17", name: "Sports" },
  { id: "10", name: "Music" },
  { id: "1", name: "Film & Animation" },
];

export function YouTubeUploadModal({
  isOpen,
  projectTitle,
  script,
  onClose,
  onConfirm,
  onBack,
  onSkip,
  onMetadataChange,
  initialTitle,
  initialDescription,
  initialTags,
  initialCategoryId,
  initialPlaylistId,
}: YouTubeUploadModalProps) {
  // Connection state
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(initialPlaylistId || null);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);

  // Form state
  const [title, setTitle] = useState(initialTitle || projectTitle || "");
  const [description, setDescription] = useState(initialDescription || "");
  const [tags, setTags] = useState(initialTags || "");
  const [categoryId, setCategoryId] = useState(initialCategoryId || "27");

  // AI generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      checkConnection();
      setTitle(initialTitle || projectTitle || "");
      setDescription(initialDescription || "");
      setTags(initialTags || "");
      setCategoryId(initialCategoryId || "27");
      setSelectedPlaylist(initialPlaylistId || null);
      setTitleOptions([]);
    }
  }, [isOpen, projectTitle, initialTitle, initialDescription, initialTags, initialCategoryId, initialPlaylistId]);

  useEffect(() => {
    if (isOpen && onMetadataChange) {
      onMetadataChange(title, description, tags, categoryId, selectedPlaylist);
    }
  }, [title, description, tags, categoryId, selectedPlaylist, isOpen, onMetadataChange]);

  const checkConnection = async () => {
    const status = await checkYouTubeConnection();
    setIsConnected(status.connected);
    if (status.connected) {
      await Promise.all([loadChannels(), loadPlaylists()]);
    }
  };

  const loadChannels = async () => {
    setIsLoadingChannels(true);
    try {
      const result = await fetchYouTubeChannels();
      if (result.channels.length > 0) {
        setChannels(result.channels);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const loadPlaylists = async () => {
    setIsLoadingPlaylists(true);
    try {
      const result = await fetchYouTubePlaylists();
      setPlaylists(result.playlists || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  // Generate 10 title ideas with AI
  const handleGenerateTitles = async () => {
    if (!script || script.trim().length === 0) {
      toast({
        title: "Script Required",
        description: "No script available for title generation.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateYouTubeMetadata(projectTitle || "Historical Documentary", script);

      if (result.success && result.titles && result.titles.length > 0) {
        setTitleOptions(result.titles);

        // Auto-fill description and tags
        if (result.description) {
          setDescription(result.description);
        }
        if (result.tags && result.tags.length > 0) {
          setTags(result.tags.join(", "));
        }

        toast({
          title: "Generated!",
          description: `${result.titles.length} title options ready. Click one to select.`,
        });
      } else {
        toast({
          title: "Generation Failed",
          description: result.error || "Failed to generate titles.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Title generation error:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate titles.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSwitchChannel = async () => {
    try {
      await disconnectYouTube();
      setIsConnected(false);
      setChannels([]);
      setPlaylists([]);
      const success = await authenticateYouTube();
      if (success) {
        await checkConnection();
      }
    } catch (error) {
      console.error('Error switching channel:', error);
      toast({
        title: "Error",
        description: "Failed to switch YouTube channel.",
        variant: "destructive",
      });
    }
  };

  const handleConfirm = () => {
    if (onMetadataChange) {
      onMetadataChange(title, description, tags, categoryId, selectedPlaylist);
    }
    onConfirm?.();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="w-5 h-5 text-red-600" />
            YouTube Upload
          </DialogTitle>
          <DialogDescription>
            Set title, description, and tags for your YouTube video
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Channel Info */}
          {isConnected === null ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : isLoadingChannels ? (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading channel info...</span>
            </div>
          ) : channels.length > 0 ? (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                {channels[0].thumbnailUrl && (
                  <img src={channels[0].thumbnailUrl} alt={channels[0].title} className="w-8 h-8 rounded-full" />
                )}
                <div>
                  <p className="text-sm font-medium">{channels[0].title}</p>
                  <p className="text-xs text-muted-foreground">Upload destination</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleSwitchChannel} className="text-xs">
                Switch
              </Button>
            </div>
          ) : !isConnected ? (
            <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              Connect YouTube account from the main page to see channel info
            </div>
          ) : null}

          {/* Title Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Title *</Label>
              {script && (
                <Button
                  onClick={handleGenerateTitles}
                  disabled={isGenerating}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Generate 10 Ideas
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* 10 Title Options - always visible when generated */}
            {titleOptions.length > 0 && (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto p-2 bg-muted/30 rounded-lg border">
                <p className="text-xs text-muted-foreground mb-2">Click a title to select it:</p>
                {titleOptions.map((opt, index) => (
                  <button
                    key={index}
                    onClick={() => setTitle(opt)}
                    className={`w-full text-left p-2.5 rounded text-sm transition-colors ${
                      title === opt
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-accent border border-border'
                    }`}
                  >
                    <span className="text-muted-foreground mr-2 font-mono text-xs">{index + 1}.</span>
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* Manual title input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter video title or generate ideas above"
              maxLength={100}
              autoComplete="off"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground text-right">{title.length}/100</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter video description"
              className="min-h-[100px] resize-y"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="history, documentary, educational (comma-separated)"
              autoComplete="off"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Playlist */}
          <div className="space-y-2">
            <Label>Add to Playlist</Label>
            <Select
              value={selectedPlaylist || "none"}
              onValueChange={(value) => setSelectedPlaylist(value === "none" ? null : value)}
              disabled={isLoadingPlaylists}
            >
              <SelectTrigger>
                {isLoadingPlaylists ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading playlists...</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Select a playlist (optional)" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No playlist</SelectItem>
                {playlists.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.title} ({playlist.itemCount} videos)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} title="Back">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" size="icon" onClick={onSkip} title="Skip">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
          </div>

          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Exit
          </Button>

          <Button onClick={handleConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
