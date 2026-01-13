/**
 * Video Analysis - VideoRAG Intelligence Page
 *
 * Shows:
 * - Analyzed videos list with status
 * - Trigger new analysis
 * - Q&A interface for querying video patterns
 * - Aggregated insights dashboard
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Search,
  BarChart3,
  Video,
  Palette,
  Clock,
  Scissors,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const API_BASE_URL = import.meta.env.VITE_RENDER_API_URL || '';

interface AnalyzedVideo {
  id: string;
  video_id: string;
  video_url: string;
  title: string | null;
  channel_name: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  status: 'pending' | 'downloading' | 'extracting' | 'analyzing' | 'complete' | 'failed';
  progress: number;
  error_message: string | null;
  avg_scene_duration: number | null;
  cuts_per_minute: number | null;
  dominant_colors: string[] | null;
  analyzed_at: string | null;
  created_at: string;
}

interface Insights {
  videoCount: number;
  avgSceneDuration: number | null;
  avgCutsPerMinute: number | null;
  topColors: { color: string; frequency: number }[];
  sceneRange: [number, number] | null;
}

interface QueryResponse {
  answer: string;
  sources: { videoId: string; title: string; channelName: string; metric: string }[];
  videoCount: number;
}

export default function VideoAnalysis() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [videos, setVideos] = useState<AnalyzedVideo[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [query, setQuery] = useState('');
  const [queryResponse, setQueryResponse] = useState<QueryResponse | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ imagebind: boolean; supabase: boolean } | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<{
    videoId: string;
    status: string;
    progress: number;
    error?: string;
  } | null>(null);

  // Poll analysis status
  const pollAnalysisStatus = async (videoId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/video-analysis/status/${videoId}`);
      const data = await response.json();

      if (data.success) {
        setCurrentAnalysis({
          videoId,
          status: data.status,
          progress: data.progress || 0,
          error: data.error,
        });

        // Keep polling if still processing
        if (data.status !== 'complete' && data.status !== 'failed') {
          setTimeout(() => pollAnalysisStatus(videoId), 2000);
        } else {
          // Analysis done - refresh videos list
          if (data.status === 'complete') {
            fetchVideos();
            toast({
              title: 'Analysis complete',
              description: `Video ${videoId} has been analyzed`,
            });
          } else if (data.status === 'failed') {
            toast({
              title: 'Analysis failed',
              description: data.error || 'Unknown error',
              variant: 'destructive',
            });
          }
          // Clear after a delay so user can see final status
          setTimeout(() => setCurrentAnalysis(null), 5000);
        }
      }
    } catch (err) {
      console.error('Failed to poll status:', err);
    }
  };

  // Fetch analyzed videos
  const fetchVideos = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/video-analysis/insights`);
      if (response.ok) {
        const data = await response.json();
        setInsights(data.insights);
      }
    } catch (err) {
      console.error('Failed to fetch insights:', err);
    }
  };

  // Check service health
  const checkHealth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/video-analysis/health`);
      if (response.ok) {
        const data = await response.json();
        setHealthStatus({
          imagebind: data.services?.imagebind?.available || false,
          supabase: data.services?.supabase || false,
        });
      }
    } catch (err) {
      console.error('Failed to check health:', err);
    }
  };

  // Initial fetch
  useEffect(() => {
    Promise.all([fetchVideos(), checkHealth()]).finally(() => setLoading(false));
  }, []);

  // Extract video ID from YouTube URL
  const extractVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^[a-zA-Z0-9_-]{11}$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1] || match[0];
    }
    return null;
  };

  // Start analysis for a new video
  const startAnalysis = async () => {
    const videoId = extractVideoId(newVideoUrl.trim());
    if (!videoId) {
      toast({
        title: 'Invalid URL',
        description: 'Please enter a valid YouTube URL or video ID',
        variant: 'destructive',
      });
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/video-analysis/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: 'Analysis started',
          description: `Processing video ${videoId}`,
        });
        setNewVideoUrl('');
        setCurrentAnalysis({
          videoId,
          status: data.status || 'pending',
          progress: 0,
        });
        // Start polling for progress
        setTimeout(() => pollAnalysisStatus(videoId), 1000);
      } else {
        throw new Error(data.error || 'Failed to start analysis');
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // Query analyzed videos
  const submitQuery = async () => {
    if (!query.trim()) return;

    setQuerying(true);
    setQueryResponse(null);
    try {
      const response = await fetch(`${API_BASE_URL}/video-analysis/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await response.json();
      if (data.success) {
        setQueryResponse({
          answer: data.answer,
          sources: data.sources || [],
          videoCount: data.videoCount || 0,
        });
      } else {
        throw new Error(data.error || 'Query failed');
      }
    } catch (err: any) {
      toast({
        title: 'Query failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setQuerying(false);
    }
  };

  // Format duration
  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Video Analysis</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => { fetchVideos(); checkHealth(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">

        {/* Analyze New Video */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Analyze New Video
            </CardTitle>
            <CardDescription>
              Enter a YouTube URL to extract visual style patterns, pacing, and color analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="https://youtube.com/watch?v=... or video ID"
                value={newVideoUrl}
                onChange={(e) => setNewVideoUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startAnalysis()}
                className="flex-1"
              />
              <Button onClick={startAnalysis} disabled={analyzing || !newVideoUrl.trim()}>
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Analyze
              </Button>
            </div>

            {/* Analysis Progress */}
            {currentAnalysis && (
              <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {currentAnalysis.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : currentAnalysis.status === 'complete' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    )}
                    <span className="font-medium">
                      {currentAnalysis.videoId}
                    </span>
                    <Badge variant={
                      currentAnalysis.status === 'failed' ? 'destructive' :
                      currentAnalysis.status === 'complete' ? 'default' : 'secondary'
                    }>
                      {currentAnalysis.status}
                    </Badge>
                  </div>
                  <span className="text-sm font-mono">
                    {currentAnalysis.progress}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      currentAnalysis.status === 'failed' ? 'bg-red-500' :
                      currentAnalysis.status === 'complete' ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${currentAnalysis.progress}%` }}
                  />
                </div>
                {currentAnalysis.error && (
                  <p className="mt-2 text-sm text-red-500">
                    Error: {currentAnalysis.error}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Insights Dashboard */}
        {insights && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Video className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{insights.videoCount}</p>
                    <p className="text-sm text-muted-foreground">Videos Analyzed</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Clock className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {insights.avgSceneDuration ? `${insights.avgSceneDuration.toFixed(1)}s` : '-'}
                    </p>
                    <p className="text-sm text-muted-foreground">Avg Scene Duration</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <Scissors className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {insights.avgCutsPerMinute ? `${insights.avgCutsPerMinute.toFixed(1)}` : '-'}
                    </p>
                    <p className="text-sm text-muted-foreground">Cuts Per Minute</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <Palette className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{insights.topColors.length}</p>
                    <p className="text-sm text-muted-foreground">Color Palette Size</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Top Colors */}
        {insights?.topColors && insights.topColors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Dominant Colors
              </CardTitle>
              <CardDescription>Most common colors across analyzed videos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {insights.topColors.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 border rounded-lg">
                    <div
                      className="w-5 h-5 rounded border"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-sm font-mono">{c.color}</span>
                    <span className="text-xs text-muted-foreground">
                      {(c.frequency * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Q&A Interface */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Ask Questions
            </CardTitle>
            <CardDescription>
              Query patterns across analyzed videos using natural language
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="What visual effects are most common? How long are intro hooks?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitQuery()}
                className="flex-1"
              />
              <Button onClick={submitQuery} disabled={querying || !query.trim()}>
                {querying ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Ask
              </Button>
            </div>

            {queryResponse && (
              <div className="space-y-4 pt-4 border-t">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="whitespace-pre-wrap">{queryResponse.answer}</p>
                </div>
                {queryResponse.sources.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Sources ({queryResponse.videoCount} videos):</p>
                    <div className="flex flex-wrap gap-2">
                      {queryResponse.sources.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {s.title || s.videoId} - {s.metric}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Empty State */}
        {!loading && (!insights || insights.videoCount === 0) && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No videos analyzed yet</h3>
              <p className="text-muted-foreground mb-4 max-w-md">
                Start by analyzing a YouTube video above. The system will extract visual patterns,
                pacing, and color analysis that you can query.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
