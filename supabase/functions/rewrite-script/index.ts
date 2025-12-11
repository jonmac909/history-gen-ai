import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, template, title, stream } = await req.json();
    
    if (!transcript) {
      return new Response(
        JSON.stringify({ error: 'Transcript is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Rewriting script with Claude Opus 4.1...');

    const systemPrompt = template || `You are an expert scriptwriter specializing in historical documentary narration. 
Your task is to transform the provided transcript into a compelling, well-structured script suitable for a history video.

Guidelines:
- Maintain historical accuracy
- Use engaging, narrative language
- Structure with clear scene breaks marked as [SCENE 1], [SCENE 2], etc.
- Each scene should be 30-60 seconds when spoken
- Add visual cues in brackets like [Show map of ancient Rome]
- Make it dramatic and captivating while staying educational
- The tone should be authoritative yet accessible`;

    // Estimate target word count based on transcript length
    const transcriptWords = transcript.split(/\s+/).length;
    const targetWords = Math.max(5000, Math.min(transcriptWords * 0.8, 20000));

    if (stream) {
      // Streaming mode
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-1-20250805',
          max_tokens: 16384,
          stream: true,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Please rewrite the following transcript into a professional history documentary script.

Title: ${title || 'Historical Documentary'}

Original Transcript:
${transcript}

Create a compelling script with clear scene breaks, visual cues, and engaging narration. Target approximately ${targetWords} words.`
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ error: `Claude API error: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Stream the response back with progress updates
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let fullScript = '';
          let tokenCount = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              
              // Process complete SSE events
              const events = buffer.split('\n\n');
              buffer = events.pop() || '';

              for (const event of events) {
                if (!event.trim()) continue;

                const lines = event.split('\n');
                let eventType = '';
                let eventData = '';

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    eventType = line.slice(7);
                  } else if (line.startsWith('data: ')) {
                    eventData = line.slice(6);
                  }
                }

                if (eventData) {
                  try {
                    const parsed = JSON.parse(eventData);
                    
                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                      fullScript += parsed.delta.text;
                      tokenCount++;
                      
                      // Send progress update every 50 tokens
                      if (tokenCount % 50 === 0) {
                        const wordCount = fullScript.split(/\s+/).length;
                        const progress = Math.min(Math.round((wordCount / targetWords) * 100), 99);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', progress, wordCount })}\n\n`));
                      }
                    } else if (parsed.type === 'message_stop') {
                      // Send final result
                      const finalWordCount = fullScript.split(/\s+/).length;
                      console.log('Script rewritten successfully, length:', fullScript.length, 'words:', finalWordCount);
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                        type: 'complete', 
                        success: true,
                        script: fullScript,
                        wordCount: finalWordCount,
                        progress: 100
                      })}\n\n`));
                    } else if (parsed.type === 'error' || parsed.error) {
                      // Handle API errors
                      const errorMessage = parsed.error?.message || parsed.message || 'AI generation failed';
                      console.error('Claude streaming error:', errorMessage);
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                        type: 'error', 
                        error: errorMessage
                      })}\n\n`));
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
            
            // If stream ended without a complete message but we have content, send it
            if (fullScript.length > 0 && tokenCount > 0) {
              const finalWordCount = fullScript.split(/\s+/).length;
              console.log('Stream ended, sending accumulated script. Words:', finalWordCount);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'complete', 
                success: true,
                script: fullScript,
                wordCount: finalWordCount,
                progress: 100
              })}\n\n`));
            }
          } catch (streamError) {
            console.error('Stream processing error:', streamError);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: streamError instanceof Error ? streamError.message : 'Stream processing failed'
            })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    } else {
      // Non-streaming mode (original behavior)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-1-20250805',
          max_tokens: 16384,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Please rewrite the following transcript into a professional history documentary script.

Title: ${title || 'Historical Documentary'}

Original Transcript:
${transcript}

Create a compelling script with clear scene breaks, visual cues, and engaging narration.`
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ error: `Claude API error: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const script = data.content[0].text;

      console.log('Script rewritten successfully, length:', script.length);

      return new Response(
        JSON.stringify({ 
          success: true,
          script,
          wordCount: script.split(/\s+/).length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error rewriting script:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to rewrite script' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
