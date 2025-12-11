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

async function pollTaskResult(apiKey: string, taskId: string, maxAttempts = 120): Promise<string[]> {
  console.log(`Polling for task result: ${taskId}`);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${KIE_API_URL}/queryTask?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // Log full response for debugging
      const responseText = await response.text();
      
      if (!response.ok) {
        console.error(`Poll error ${response.status}: ${responseText}`);
        // On 404, the task may not exist yet - wait and retry
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('Failed to parse response:', responseText);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      console.log(`Poll attempt ${attempt + 1}, code: ${data.code}, state:`, data.data?.state);

      if (data.code === 200 && data.data?.state === 'success') {
        try {
          const resultJson = JSON.parse(data.data.resultJson);
          return resultJson.resultUrls || [];
        } catch (e) {
          console.error('Failed to parse resultJson:', data.data.resultJson);
          return [];
        }
      } else if (data.data?.state === 'fail') {
        throw new Error(data.data.failMsg || 'Image generation failed');
      } else if (data.code !== 200) {
        console.log(`Non-200 code: ${data.code}, message: ${data.message}`);
      }

      // Wait 3 seconds before next poll (increased from 2s)
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (fetchError) {
      console.error('Fetch error during poll:', fetchError);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  throw new Error('Image generation timed out after max attempts');
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
