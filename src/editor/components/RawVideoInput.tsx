/**
 * RawVideoInput - Upload raw video for editing
 */
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Link as LinkIcon, Loader2, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface RawVideoInputProps {
  selectedTemplateId: string | null;
}

export function RawVideoInput({ selectedTemplateId }: RawVideoInputProps) {
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  const analyzeRawVideo = async () => {
    if (!videoUrl.trim() || !projectName.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please provide both video URL and project name',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedTemplateId) {
      toast({
        title: 'No Template Selected',
        description: 'Please select a template first',
        variant: 'destructive',
      });
      return;
    }

    try {
      setAnalyzing(true);
      setProgress(0);

      // TODO: Implement backend API call to analyze raw video
      // For now, just simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 5000));
      clearInterval(progressInterval);
      setProgress(100);

      toast({
        title: 'Success',
        description: 'Video analyzed! Go to Preview & Render to see edits.',
      });

      // Reset form
      setVideoUrl('');
      setProjectName('');
      setProgress(0);
    } catch (error: any) {
      console.error('Failed to analyze raw video:', error);
      toast({
        title: 'Error',
        description: 'Failed to analyze video',
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold mb-2">Upload Raw Video</h2>
        <p className="text-muted-foreground">
          Upload your raw footage for AI analysis and automated editing
        </p>
      </div>

      {!selectedTemplateId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select a template from the Templates tab first
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload Raw Footage</CardTitle>
          <CardDescription>
            Provide the video you want to edit using the selected template
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Upload Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={uploadMode === 'url' ? 'default' : 'outline'}
              onClick={() => setUploadMode('url')}
              className="flex-1"
            >
              <LinkIcon className="w-4 h-4 mr-2" />
              URL
            </Button>
            <Button
              variant={uploadMode === 'file' ? 'default' : 'outline'}
              onClick={() => setUploadMode('file')}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              File Upload
            </Button>
          </div>

          {/* Video Input */}
          <div className="space-y-2">
            <Label htmlFor="rawVideoInput">
              {uploadMode === 'url' ? 'Video URL' : 'Video File'}
            </Label>
            {uploadMode === 'url' ? (
              <Input
                id="rawVideoInput"
                placeholder="https://youtube.com/watch?v=... or direct video URL"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={analyzing}
              />
            ) : (
              <Input
                id="rawVideoInput"
                type="file"
                accept="video/*"
                disabled={analyzing}
              />
            )}
          </div>

          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="projectName">Project Name</Label>
            <Input
              id="projectName"
              placeholder="e.g., Q1 Product Review"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={analyzing}
            />
          </div>

          {/* Selected Template Info */}
          {selectedTemplateId && (
            <Alert>
              <AlertDescription>
                Template selected. AI will apply this editing style to your raw footage.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress */}
          {analyzing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Analyzing video...</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {progress < 30 && 'Detecting scenes...'}
                {progress >= 30 && progress < 60 && 'Transcribing audio...'}
                {progress >= 60 && progress < 90 && 'Identifying key moments...'}
                {progress >= 90 && 'Generating edit decisions...'}
              </p>
            </div>
          )}

          {/* Analyze Button */}
          <Button
            onClick={analyzeRawVideo}
            disabled={
              analyzing ||
              !videoUrl.trim() ||
              !projectName.trim() ||
              !selectedTemplateId
            }
            className="w-full"
            size="lg"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Analyze & Generate Edits
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle className="text-base">Analysis includes:</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Scene detection and segmentation</li>
            <li>• Speech-to-text transcription</li>
            <li>• Key moment identification (hooks, highlights, CTAs)</li>
            <li>• Audio beat detection for rhythm sync</li>
            <li>• AI-generated edit decisions based on template</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
