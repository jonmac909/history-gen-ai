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
  stream?: boolean;
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

async function pollSingleTask(apiKey: string, taskId: string, maxAttempts = 120): Promise<string[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${KIE_API_URL}/queryTask?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        console.error(`Poll error ${response.status}: ${responseText}`);
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
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (fetchError) {
      console.error('Fetch error during poll:', fetchError);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
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

    const { prompts, quality, aspectRatio = "16:9", stream = false }: GenerateImagesRequest = await req.json();

    if (!prompts || prompts.length === 0) {
      throw new Error('No prompts provided');
    }

    console.log(`Generating ${prompts.length} images with quality: ${quality}, stream: ${stream}`);

    if (stream) {
      // Streaming mode - report progress as each image completes
      const encoder = new TextEncoder();
      
      const responseStream = new ReadableStream({
        async start(controller) {
          const allImages: string[] = [];
          let completed = 0;
          const total = prompts.length;
          
          // Send initial progress
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            completed: 0, 
            total,
            message: `Starting ${total} images...`
          })}\n\n`));

          // Process images one by one for progress updates
          for (let i = 0; i < prompts.length; i++) {
            try {
              const prompt = prompts[i];
              console.log(`Processing image ${i + 1}/${total}`);
              
              // Create task
              const taskId = await createImageTask(apiKey, prompt, quality, aspectRatio);
              
              // Poll for this single task
              const urls = await pollSingleTask(apiKey, taskId);
              allImages.push(...urls);
              
              completed++;
              console.log(`Image ${completed}/${total} completed`);
              
              // Send progress update
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                completed,
                total,
                urls,
                message: `${completed}/${total} images done`
              })}\n\n`));
              
            } catch (imgError) {
              console.error(`Error generating image ${i + 1}:`, imgError);
              completed++;
              // Continue with next image even if one fails
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                completed,
                total,
                error: imgError instanceof Error ? imgError.message : 'Failed',
                message: `${completed}/${total} (1 failed)`
              })}\n\n`));
            }
          }

          // Send completion
          console.log(`All images complete. Total: ${allImages.length}`);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'complete',
            success: true,
            images: allImages,
            total: allImages.length
          })}\n\n`));
          
          controller.close();
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
      // Non-streaming mode - original parallel behavior
      const taskIds = await Promise.all(
        prompts.map(prompt => createImageTask(apiKey, prompt, quality, aspectRatio))
      );

      const imageResults = await Promise.all(
        taskIds.map(taskId => pollSingleTask(apiKey, taskId))
      );

      const imageUrls = imageResults.flat();

      console.log(`Generated ${imageUrls.length} images successfully`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          images: imageUrls 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
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
