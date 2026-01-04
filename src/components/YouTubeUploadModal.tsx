import { useState, useEffect } from "react";
import {
  Youtube,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
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
import { Input } from "@/components/ui/input";
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
  script?: string; // Script content for AI metadata generation
  onClose: () => void;
  onConfirm?: () => void; // Called when user confirms metadata
  onBack?: () => void;
  onSkip?: () => void;
  // Callback when title/description changes (for preview sync)
  onMetadataChange?: (title: string, description: string, tags: string, categoryId: string, playlistId: string | null) => void;
  // Initial values from parent (for persistence)
  initialTitle?: string;
  initialDescription?: string;
  initialTags?: string;
  initialCategoryId?: string;
  initialPlaylistId?: string | null;
}

// YouTube video categories
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

  // Channel state
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);

  // Playlist state
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(initialPlaylistId || null);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);

  // Form state
  const [title, setTitle] = useState(initialTitle || projectTitle || "");
  const [description, setDescription] = useState(initialDescription || "");
  const [tags, setTags] = useState(initialTags || "");
  const [categoryId, setCategoryId] = useState(initialCategoryId || "27"); // Default: Education

  // AI generation state
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);
  const [showTitleSelector, setShowTitleSelector] = useState(false);

  // Check connection status on open
  useEffect(() => {
    if (isOpen) {
      checkConnection();
      // Use saved values if available, otherwise fall back to project title
      setTitle(initialTitle || projectTitle || "");
      setDescription(initialDescription || "");
      setTags(initialTags || "");
      setCategoryId(initialCategoryId || "27");
      setSelectedPlaylist(initialPlaylistId || null);
      setGeneratedTitles([]);
      setShowTitleSelector(false);
    }
  }, [isOpen, projectTitle, initialTitle, initialDescription, initialTags, initialCategoryId, initialPlaylistId]);

  // Notify parent when any metadata changes
  useEffect(() => {
    if (isOpen && onMetadataChange) {
      onMetadataChange(title, description, tags, categoryId, selectedPlaylist);
    }
  }, [title, description, tags, categoryId, selectedPlaylist, isOpen, onMetadataChange]);

  const checkConnection = async () => {
    const status = await checkYouTubeConnection();
    setIsConnected(status.connected);

    // Fetch channels and playlists when connected
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

  // AI-powered metadata generation
  const handleGenerateMetadata = async () => {
    console.log('[YouTubeUploadModal] handleGenerateMetadata called, script length:', script?.length);

    if (!script || script.trim().length === 0) {
      toast({
        title: "Script Required",
        description: "No script available for metadata generation.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingMetadata(true);
    try {
      console.log('[YouTubeUploadModal] Calling API...');
      const result = await generateYouTubeMetadata(projectTitle || "Historical Documentary", script);
      console.log('[YouTubeUploadModal] API result:', JSON.stringify(result).slice(0, 500));

      if (result.success && result.titles) {
        console.log('[YouTubeUploadModal] Got', result.titles.length, 'titles');
        setGeneratedTitles(result.titles);
        setShowTitleSelector(true);

        // Auto-fill description and tags
        if (result.description) {
          setDescription(result.description);
        }
        if (result.tags && result.tags.length > 0) {
          setTags(result.tags.join(", "));
        }

        toast({
          title: "Metadata Generated",
          description: "Select a title and review the description & tags.",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: result.error || "Failed to generate metadata.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Metadata generation error:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate metadata.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingMetadata(false);
    }
  };

  const handleSelectTitle = (selectedTitle: string) => {
    setTitle(selectedTitle);
    setShowTitleSelector(false);
  };

  // Handle switching YouTube channel
  const handleSwitchChannel = async () => {
    try {
      await disconnectYouTube();
      setIsConnected(false);
      setChannels([]);
      setPlaylists([]);

      // Re-authenticate
      const success = await authenticateYouTube();
      if (success) {
        await checkConnection();
      }
    } catch (error) {
      console.error('Error switching channel:', error);
      toast({
        title: "Error",
        description: "Failed to switch YouTube channel. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle confirm - save metadata and close
  const handleConfirm = () => {
    // Notify parent with final metadata
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
          {/* Channel Info - show which channel will receive the upload */}
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
                  <img
                    src={channels[0].thumbnailUrl}
                    alt={channels[0].title}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div>
                  <p className="text-sm font-medium">{channels[0].title}</p>
                  <p className="text-xs text-muted-foreground">Upload destination</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSwitchChannel}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Switch
              </Button>
            </div>
          ) : !isConnected ? (
            <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              Connect YouTube account from the main page to see channel info
            </div>
          ) : null}

          {/* AI Auto-fill Button */}
          {script && (
            <Button
              onClick={handleGenerateMetadata}
              disabled={isGeneratingMetadata}
              variant="outline"
              className="w-full gap-2 border-primary/50 text-primary hover:bg-primary/10"
            >
              {isGeneratingMetadata ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating with AI...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Auto-fill with AI (Title, Description, Tags)
                </>
              )}
            </Button>
          )}

          {/* Title Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="title">Title *</Label>
              {generatedTitles.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTitleSelector(!showTitleSelector)}
                  className="h-6 px-2 text-xs gap-1"
                >
                  {showTitleSelector ? (
                    <>Hide options <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>Show {generatedTitles.length} options <ChevronDown className="w-3 h-3" /></>
                  )}
                </Button>
              )}
            </div>

            {/* Title Selector (shown after AI generation) */}
            {showTitleSelector && generatedTitles.length > 0 && (
              <div className="space-y-1.5 max-h-[250px] overflow-y-auto p-2 bg-muted/30 rounded-lg border">
                {generatedTitles.map((generatedTitle, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectTitle(generatedTitle)}
                    className={`w-full text-left p-2.5 rounded text-sm transition-colors ${
                      title === generatedTitle
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-accent border border-border'
                    }`}
                  >
                    <span className="text-muted-foreground mr-2 font-mono">{index + 1}.</span>
                    {generatedTitle}
                  </button>
                ))}
              </div>
            )}

            {/* Title Input (always visible for manual editing) */}
            <input
              id="youtube-video-title"
              name="youtube-video-title"
              type="text"
              autoComplete="new-password"
              data-lpignore="true"
              data-form-type="other"
              data-1p-ignore="true"
              spellCheck="false"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter video title or select from AI options above"
              maxLength={100}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            <p className="text-xs text-muted-foreground text-right">
              {title.length}/100
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter video description"
              className="min-h-[100px] resize-y"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="history, documentary, educational (comma-separated)"
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

          {/* Playlist Selection */}
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

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          {/* Left side: Navigation */}
          <div className="flex gap-2 mr-auto">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} title="Back to previous step">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" size="icon" onClick={onSkip} title="Skip to next step">
                <ChevronRight className="w-5 h-5" />
              </Button>
            )}
          </div>

          {/* Right side: Exit + Confirm */}
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
