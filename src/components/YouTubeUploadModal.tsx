import { useState, useEffect } from "react";
import {
  Youtube,
  Upload,
  Loader2,
  Check,
  Calendar,
  ExternalLink,
  Unlink,
  ChevronLeft,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ImagePlus,
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
import { Progress } from "@/components/ui/progress";
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
  authenticateYouTube,
  checkYouTubeConnection,
  disconnectYouTube,
  getValidAccessToken,
  fetchYouTubeChannels,
  type YouTubeChannel,
} from "@/lib/youtubeAuth";
import { uploadToYouTube, generateYouTubeMetadata, type YouTubeUploadProgress } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

interface YouTubeUploadModalProps {
  isOpen: boolean;
  videoUrl: string;
  projectTitle?: string;
  script?: string; // Script content for AI metadata generation
  thumbnails?: string[]; // Previously generated thumbnails
  selectedThumbnailIndex?: number; // Index of previously selected thumbnail
  onClose: () => void;
  onSuccess?: (youtubeUrl: string) => void;
  onBack?: () => void;
  onSkip?: () => void;
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
  videoUrl,
  projectTitle,
  script,
  thumbnails,
  selectedThumbnailIndex,
  onClose,
  onSuccess,
  onBack,
  onSkip,
}: YouTubeUploadModalProps) {
  // Connection state
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Channel state
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);

  // Form state
  const [title, setTitle] = useState(projectTitle || "");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [categoryId, setCategoryId] = useState("27"); // Default: Education
  const [privacyStatus, setPrivacyStatus] = useState<"private" | "unlisted">("private");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("12:00");
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(null);
  const [customThumbnailFile, setCustomThumbnailFile] = useState<File | null>(null);
  const [customThumbnailPreview, setCustomThumbnailPreview] = useState<string | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<YouTubeUploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    videoId: string;
    youtubeUrl: string;
    studioUrl: string;
  } | null>(null);

  // AI generation state
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);
  const [showTitleSelector, setShowTitleSelector] = useState(false);

  // Check connection status on open
  useEffect(() => {
    if (isOpen) {
      checkConnection();
      // Reset form when opening
      setTitle(projectTitle || "");
      setUploadResult(null);
      setProgress(null);
      setGeneratedTitles([]);
      setShowTitleSelector(false);
      // Reset custom thumbnail
      setCustomThumbnailFile(null);
      setCustomThumbnailPreview(null);
      // Auto-select thumbnail at saved index, or first one if no selection
      if (thumbnails && thumbnails.length > 0) {
        const indexToSelect = selectedThumbnailIndex !== undefined && selectedThumbnailIndex < thumbnails.length
          ? selectedThumbnailIndex
          : 0;
        setSelectedThumbnail(thumbnails[indexToSelect]);
      } else {
        setSelectedThumbnail(null);
      }
    }
  }, [isOpen, projectTitle, thumbnails, selectedThumbnailIndex]);

  const checkConnection = async () => {
    const status = await checkYouTubeConnection();
    setIsConnected(status.connected);

    // Fetch channels when connected
    if (status.connected) {
      await loadChannels();
    }
  };

  const loadChannels = async () => {
    setIsLoadingChannels(true);
    try {
      const result = await fetchYouTubeChannels();
      if (result.channels.length > 0) {
        setChannels(result.channels);
        // Auto-select first channel if only one, or if none selected
        if (result.channels.length === 1 || !selectedChannel) {
          setSelectedChannel(result.channels[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await authenticateYouTube();
      if (result.success) {
        setIsConnected(true);
        // Fetch channels after connecting
        await loadChannels();
        toast({
          title: "YouTube Connected",
          description: "Your YouTube account is now connected.",
        });
      } else {
        toast({
          title: "Connection Failed",
          description: result.error || "Failed to connect YouTube account.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect YouTube account.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const success = await disconnectYouTube();
    if (success) {
      setIsConnected(false);
      toast({
        title: "YouTube Disconnected",
        description: "Your YouTube account has been disconnected.",
      });
    } else {
      toast({
        title: "Disconnect Failed",
        description: "Failed to disconnect YouTube account.",
        variant: "destructive",
      });
    }
  };

  // AI-powered metadata generation
  const handleGenerateMetadata = async () => {
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
      const result = await generateYouTubeMetadata(projectTitle || "Historical Documentary", script);

      if (result.success && result.titles) {
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

  // Handle custom thumbnail file selection
  const handleCustomThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please select a JPEG, PNG, GIF, or BMP image.",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 2MB for YouTube)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Thumbnail must be less than 2MB.",
        variant: "destructive",
      });
      return;
    }

    setCustomThumbnailFile(file);
    // Clear any selected generated thumbnail
    setSelectedThumbnail(null);

    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setCustomThumbnailPreview(previewUrl);
  };

  const handleRemoveCustomThumbnail = () => {
    if (customThumbnailPreview) {
      URL.revokeObjectURL(customThumbnailPreview);
    }
    setCustomThumbnailFile(null);
    setCustomThumbnailPreview(null);
  };

  const handleUpload = async () => {
    if (!title.trim()) {
      toast({
        title: "Title Required",
        description: "Please enter a title for your video.",
        variant: "destructive",
      });
      return;
    }

    // Get access token
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      setIsConnected(false);
      toast({
        title: "Authentication Required",
        description: "Please reconnect your YouTube account.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setProgress(null);
    setUploadResult(null);

    try {
      // Build publishAt if scheduled
      let publishAt: string | undefined;
      if (isScheduled && scheduledDate && scheduledTime) {
        const dateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
        publishAt = dateTime.toISOString();
      }

      // Parse tags
      const tagArray = tags
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Determine thumbnail URL - upload custom file if provided
      let thumbnailUrl = selectedThumbnail || undefined;
      if (customThumbnailFile) {
        setProgress({ percent: 0, message: 'Uploading custom thumbnail...' });
        const ext = customThumbnailFile.name.split('.').pop() || 'jpg';
        const fileName = `thumbnails/custom_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('generated-assets')
          .upload(fileName, customThumbnailFile, {
            contentType: customThumbnailFile.type,
            upsert: true,
          });

        if (uploadError) {
          console.error('Failed to upload custom thumbnail:', uploadError);
          toast({
            title: "Thumbnail Upload Failed",
            description: "Failed to upload custom thumbnail. Continuing without thumbnail.",
            variant: "destructive",
          });
        } else {
          const { data: urlData } = supabase.storage
            .from('generated-assets')
            .getPublicUrl(fileName);
          thumbnailUrl = urlData.publicUrl;
        }
      }

      const result = await uploadToYouTube(
        {
          videoUrl,
          accessToken,
          title: title.trim(),
          description: description.trim(),
          tags: tagArray,
          categoryId,
          privacyStatus: isScheduled ? "private" : privacyStatus,
          publishAt,
          thumbnailUrl,
        },
        (progress) => setProgress(progress)
      );

      if (result.success && result.videoId) {
        setUploadResult({
          videoId: result.videoId,
          youtubeUrl: result.youtubeUrl!,
          studioUrl: result.studioUrl!,
        });
        toast({
          title: "Upload Complete!",
          description: "Your video has been uploaded to YouTube.",
        });
        onSuccess?.(result.youtubeUrl!);
      } else {
        toast({
          title: "Upload Failed",
          description: result.error || "Failed to upload video to YouTube.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("YouTube upload error:", error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload video.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Get minimum date for scheduler (tomorrow)
  const getMinDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="w-5 h-5 text-red-600" />
            Upload to YouTube
          </DialogTitle>
          <DialogDescription>
            {uploadResult
              ? "Your video has been uploaded successfully!"
              : "Upload your video to YouTube as a draft for review"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Connection Status */}
          {isConnected === null ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !isConnected ? (
            <div className="border rounded-lg p-4 bg-muted/30 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your YouTube account to upload videos
              </p>
              <Button onClick={handleConnect} disabled={isConnecting} className="gap-2">
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Youtube className="w-4 h-4" />
                    Connect YouTube Account
                  </>
                )}
              </Button>
            </div>
          ) : uploadResult ? (
            // Success State
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <div className="rounded-full bg-green-100 p-3">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <p className="font-medium">Video uploaded successfully!</p>
                <p className="text-sm text-muted-foreground">
                  {isScheduled
                    ? "Your video is scheduled and will be published at the set time."
                    : "Your video is saved as a private draft. Review it in YouTube Studio before publishing."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => window.open(uploadResult.studioUrl, "_blank")}
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in YouTube Studio
                </Button>
                <Button
                  variant="ghost"
                  className="w-full gap-2"
                  onClick={() => window.open(uploadResult.youtubeUrl, "_blank")}
                >
                  <Youtube className="w-4 h-4" />
                  View on YouTube
                </Button>
              </div>
            </div>
          ) : (
            // Upload Form
            <>
              {/* Channel Info - show which channel will receive the upload */}
              {isLoadingChannels ? (
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
                    onClick={async () => {
                      // Disconnect and reconnect to allow channel selection
                      await handleDisconnect();
                      toast({
                        title: "Reconnect Required",
                        description: "Please reconnect and select a different channel during Google sign-in.",
                      });
                    }}
                    disabled={isUploading}
                    className="text-xs"
                  >
                    Switch Channel
                  </Button>
                </div>
              ) : null}

              {/* AI Auto-fill Button */}
              {script && (
                <Button
                  onClick={handleGenerateMetadata}
                  disabled={isGeneratingMetadata || isUploading}
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

              {/* Title Selector (shown after AI generation) */}
              {showTitleSelector && generatedTitles.length > 0 && (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg border border-primary/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-primary font-medium">Select a Title:</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowTitleSelector(false)}
                      className="h-6 px-2 text-xs"
                    >
                      {showTitleSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </Button>
                  </div>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {generatedTitles.map((generatedTitle, index) => (
                      <button
                        key={index}
                        onClick={() => handleSelectTitle(generatedTitle)}
                        className={`w-full text-left p-2 rounded text-sm transition-colors ${
                          title === generatedTitle
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background hover:bg-accent border border-border'
                        }`}
                      >
                        <span className="text-muted-foreground mr-2">{index + 1}.</span>
                        {generatedTitle}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter video title"
                  maxLength={100}
                  disabled={isUploading}
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
                  disabled={isUploading}
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
                  disabled={isUploading}
                />
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={isUploading}>
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

              {/* Thumbnail Selection */}
              <div className="space-y-2">
                <Label>Thumbnail</Label>
                <p className="text-xs text-muted-foreground">
                  {thumbnails && thumbnails.length > 0
                    ? "Select a generated thumbnail or upload your own"
                    : "Upload a custom thumbnail (optional - YouTube will auto-generate if not provided)"}
                </p>

                {/* Generated thumbnails grid */}
                {thumbnails && thumbnails.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {thumbnails.map((thumb, index) => (
                      <div
                        key={index}
                        className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                          selectedThumbnail === thumb && !customThumbnailPreview
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border hover:border-primary/50"
                        }`}
                        onClick={() => {
                          setSelectedThumbnail(selectedThumbnail === thumb ? null : thumb);
                          // Clear custom thumbnail when selecting generated one
                          if (customThumbnailPreview) {
                            handleRemoveCustomThumbnail();
                          }
                        }}
                      >
                        <img
                          src={thumb}
                          alt={`Thumbnail ${index + 1}`}
                          className="w-full aspect-video object-cover"
                        />
                        {selectedThumbnail === thumb && !customThumbnailPreview && (
                          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                            <Check className="w-6 h-6 text-primary" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Custom thumbnail upload */}
                {customThumbnailPreview ? (
                  <div className="relative">
                    <div className="relative rounded-lg border-2 border-primary ring-2 ring-primary/20 overflow-hidden">
                      <img
                        src={customThumbnailPreview}
                        alt="Custom thumbnail"
                        className="w-full aspect-video object-cover"
                      />
                      <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                        <Check className="w-6 h-6 text-primary" />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                      onClick={handleRemoveCustomThumbnail}
                      disabled={isUploading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">Custom thumbnail selected</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      id="custom-thumbnail"
                      accept="image/jpeg,image/png,image/gif,image/bmp"
                      onChange={handleCustomThumbnailSelect}
                      disabled={isUploading}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('custom-thumbnail')?.click()}
                      disabled={isUploading}
                      className="gap-2"
                    >
                      <ImagePlus className="w-4 h-4" />
                      Upload Custom Thumbnail
                    </Button>
                    <span className="text-xs text-muted-foreground">Max 2MB, JPEG/PNG/GIF/BMP</span>
                  </div>
                )}
              </div>

              {/* Privacy / Schedule */}
              <div className="space-y-3">
                <Label>Visibility</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={!isScheduled && privacyStatus === "private" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsScheduled(false);
                      setPrivacyStatus("private");
                    }}
                    disabled={isUploading}
                  >
                    Private (Draft)
                  </Button>
                  <Button
                    type="button"
                    variant={!isScheduled && privacyStatus === "unlisted" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsScheduled(false);
                      setPrivacyStatus("unlisted");
                    }}
                    disabled={isUploading}
                  >
                    Unlisted
                  </Button>
                  <Button
                    type="button"
                    variant={isScheduled ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsScheduled(true)}
                    disabled={isUploading}
                    className="gap-1"
                  >
                    <Calendar className="w-3 h-3" />
                    Schedule
                  </Button>
                </div>

                {/* Schedule Date/Time */}
                {isScheduled && (
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1">
                      <Input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        min={getMinDate()}
                        disabled={isUploading}
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        type="time"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        disabled={isUploading}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {progress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{progress.message}</span>
                    <span className="font-medium">{progress.percent}%</span>
                  </div>
                  <Progress value={progress.percent} className="h-2" />
                </div>
              )}

              {/* Upload Button */}
              <Button
                onClick={handleUpload}
                disabled={!title.trim() || isUploading || (isScheduled && !scheduledDate)}
                className="w-full gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload to YouTube
                  </>
                )}
              </Button>

              {/* Disconnect Option */}
              <div className="pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={isUploading}
                  className="text-muted-foreground gap-1"
                >
                  <Unlink className="w-3 h-3" />
                  Disconnect YouTube Account
                </Button>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto sm:mr-auto">
            {onBack && !isUploading && !uploadResult && (
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            {onSkip && !isUploading && !uploadResult && (
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            {uploadResult ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
