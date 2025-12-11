import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const KIE_API_URL = "https://api.kie.ai/api/v1/jobs";

interface GenerateImagesRequest {
  prompts: string[];
  quality: string;
  aspectRatio?: string;
}

async function createImageTask(apiKey: string, prompt: string, quality: string, aspectRatio: string): Promise<string> {
  console.log(`Creating image task for prompt: ${prompt.substring(0, 50)}...`);
  
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
  console.log('Task created:', data);
  
  if (data.code !== 200) {
    throw new Error(data.message || 'Failed to create task');
  }
  
  return data.data.taskId;
}

async function pollTaskResult(apiKey: string, taskId: string, maxAttempts = 60): Promise<string[]> {
  console.log(`Polling for task result: ${taskId}`);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${KIE_API_URL}/queryTask?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error('Poll error:', response.status);
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }

    const data = await response.json();
    console.log(`Poll attempt ${attempt + 1}, state:`, data.data?.state);

    if (data.data?.state === 'success') {
      const resultJson = JSON.parse(data.data.resultJson);
      return resultJson.resultUrls || [];
    } else if (data.data?.state === 'fail') {
      throw new Error(data.data.failMsg || 'Image generation failed');
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Image generation timed out');
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

    const { prompts, quality, aspectRatio = "16:9" }: GenerateImagesRequest = await req.json();

    if (!prompts || prompts.length === 0) {
      throw new Error('No prompts provided');
    }

    console.log(`Generating ${prompts.length} images with quality: ${quality}`);

    // Create tasks for all prompts
    const taskIds = await Promise.all(
      prompts.map(prompt => createImageTask(apiKey, prompt, quality, aspectRatio))
    );

    // Poll for all results
    const imageResults = await Promise.all(
      taskIds.map(taskId => pollTaskResult(apiKey, taskId))
    );

    // Flatten results (each task may return multiple URLs)
    const imageUrls = imageResults.flat();

    console.log(`Generated ${imageUrls.length} images successfully`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        images: imageUrls 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in generate-images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
