import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const KIE_API_URL = "https://api.kie.ai/api/v1/jobs";

interface GenerateImagesRequest {
  prompts: string[];
  quality: string;
  aspectRatio?: string;
  stream?: boolean;
}

interface TaskStatus {
  taskId: string;
  index: number;
  state: 'pending' | 'success' | 'fail';
  urls: string[];
  error?: string;
}

async function createImageTask(apiKey: string, prompt: string, quality: string, aspectRatio: string): Promise<string> {
  console.log(`Creating task for: ${prompt.substring(0, 50)}...`);
  
  const response = await fetch(`${KIE_API_URL}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "seedream/4.5-text-to-image",
      input: {
        prompt,
        aspect_ratio: aspectRatio,
        quality: quality === "high" ? "high" : "basic",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Kie AI createTask error:', response.status, errorText);
    throw new Error(`Failed to create image task: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.code !== 200) {
    throw new Error(data.message || 'Failed to create task');
  }
  
  console.log(`Task created: ${data.data.taskId}`);
  return data.data.taskId;
}

async function checkTaskStatus(apiKey: string, taskId: string): Promise<{ state: string; urls: string[]; error?: string }> {
  try {
    const response = await fetch(`${KIE_API_URL}/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { state: 'pending', urls: [] };
    }

    const data = await response.json();
    
    if (data.code === 200 && data.data?.state === 'success') {
      try {
        const resultJson = JSON.parse(data.data.resultJson);
        return { state: 'success', urls: resultJson.resultUrls || [] };
      } catch {
        return { state: 'success', urls: [] };
      }
    } else if (data.data?.state === 'fail') {
      return { state: 'fail', urls: [], error: data.data.failMsg || 'Failed' };
    }
    
    return { state: data.data?.state || 'pending', urls: [] };
  } catch {
    return { state: 'pending', urls: [] };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('KIE_API_KEY');
    if (!apiKey) {
      throw new Error('KIE_API_KEY not configured');
    }

    const { prompts, quality, aspectRatio = "16:9", stream = false }: GenerateImagesRequest = await req.json();

    if (!prompts || prompts.length === 0) {
      throw new Error('No prompts provided');
    }

    const total = prompts.length;
    console.log(`Generating ${total} images with quality: ${quality}, stream: ${stream}`);

    if (stream) {
      const encoder = new TextEncoder();
      
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            // Step 1: Create ALL tasks in parallel upfront
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              completed: 0, 
              total,
              message: `Creating ${total} image tasks...`
            })}\n\n`));

            const taskIds: string[] = [];
            const createPromises = prompts.map(async (prompt, index) => {
              try {
                const taskId = await createImageTask(apiKey, prompt, quality, aspectRatio);
                return { index, taskId, error: null };
              } catch (err) {
                return { index, taskId: null, error: err instanceof Error ? err.message : 'Failed' };
              }
            });

            const createResults = await Promise.all(createPromises);
            
            // Build task list
            const tasks: TaskStatus[] = createResults.map(r => ({
              taskId: r.taskId || '',
              index: r.index,
              state: r.taskId ? 'pending' : 'fail',
              urls: [],
              error: r.error || undefined
            }));

            console.log(`Created ${tasks.filter(t => t.state === 'pending').length}/${total} tasks`);

            // Step 2: Poll ALL tasks in parallel until all complete
            const maxPollingTime = 5 * 60 * 1000; // 5 minutes max
            const pollInterval = 3000; // 3 seconds
            const startTime = Date.now();
            
            while (Date.now() - startTime < maxPollingTime) {
              const pendingTasks = tasks.filter(t => t.state === 'pending');
              
              if (pendingTasks.length === 0) {
                console.log('All tasks completed');
                break;
              }

              // Check all pending tasks in parallel
              const checkPromises = pendingTasks.map(async (task) => {
                const status = await checkTaskStatus(apiKey, task.taskId);
                return { task, status };
              });

              const results = await Promise.all(checkPromises);
              
              let progressChanged = false;
              for (const { task, status } of results) {
                if (status.state === 'success') {
                  task.state = 'success';
                  task.urls = status.urls;
                  progressChanged = true;
                  console.log(`Task ${task.index + 1}/${total} completed`);
                } else if (status.state === 'fail') {
                  task.state = 'fail';
                  task.error = status.error;
                  progressChanged = true;
                  console.log(`Task ${task.index + 1}/${total} failed: ${status.error}`);
                }
              }

              const completed = tasks.filter(t => t.state !== 'pending').length;
              
              // Send progress update
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                completed,
                total,
                message: `${completed}/${total} images done`
              })}\n\n`));

              if (pendingTasks.length > 0) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
              }
            }

            // Collect all successful images
            const allImages = tasks
              .filter(t => t.state === 'success')
              .flatMap(t => t.urls);

            const failedCount = tasks.filter(t => t.state === 'fail').length;
            
            console.log(`Complete: ${allImages.length} images, ${failedCount} failed`);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete',
              success: true,
              images: allImages,
              total: allImages.length,
              failed: failedCount
            })}\n\n`));
            
          } catch (err) {
            console.error('Stream error:', err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error',
              error: err instanceof Error ? err.message : 'Generation failed'
            })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(responseStream, {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });
    } else {
      // Non-streaming mode - parallel creation and polling
      const taskIds = await Promise.all(
        prompts.map(prompt => createImageTask(apiKey, prompt, quality, aspectRatio))
      );

      // Poll all in parallel
      const maxPollingTime = 5 * 60 * 1000;
      const pollInterval = 3000;
      const startTime = Date.now();
      const results: string[][] = new Array(taskIds.length).fill([]);
      const completed: boolean[] = new Array(taskIds.length).fill(false);

      while (Date.now() - startTime < maxPollingTime) {
        const pendingIndices = completed.map((c, i) => c ? -1 : i).filter(i => i >= 0);
        
        if (pendingIndices.length === 0) break;

        const checks = await Promise.all(
          pendingIndices.map(async (i) => {
            const status = await checkTaskStatus(apiKey, taskIds[i]);
            return { index: i, status };
          })
        );

        for (const { index, status } of checks) {
          if (status.state === 'success' || status.state === 'fail') {
            completed[index] = true;
            results[index] = status.urls;
          }
        }

        if (pendingIndices.length > 0) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      const imageUrls = results.flat();
      console.log(`Generated ${imageUrls.length} images`);

      return new Response(
        JSON.stringify({ success: true, images: imageUrls }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: unknown) {
    console.error('Error in generate-images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
