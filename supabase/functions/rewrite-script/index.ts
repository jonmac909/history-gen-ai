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
    const { transcript, template, title } = await req.json();
    
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

    console.log('Rewriting script with Claude Opus 4.5...');

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

  } catch (error) {
    console.error('Error rewriting script:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to rewrite script' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
