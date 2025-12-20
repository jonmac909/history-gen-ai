import { Router, Request, Response } from 'express';

const router = Router();

// For now, proxy to Supabase function
// TODO: Migrate fully to Railway if needed
router.post('/', async (req: Request, res: Response) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    // Proxy to Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Audio generation error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Audio generation failed'
    });
  }
});

export default router;
