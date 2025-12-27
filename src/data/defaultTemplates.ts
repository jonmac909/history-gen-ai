import type { ScriptTemplate, FormatTemplate, ImageTemplate } from "@/components/ConfigModal";

// ===== FORMAT TEMPLATES =====
// These define the structure and format of the script

const formatListicle = `Write a 2-hour narrated script (approximately 18,000 words) in listicle format.

*Title:* [INSERT TITLE - e.g., "10 Ways You Wouldn't Survive Medieval Times" / "10 Things That Would Shock You About Ancient Rome" / "10 Reasons Life in Victorian England Was Terrifying"]

*The 10 Things:* [LIST YOUR 10 SPECIFIC ITEMS HERE]
1. [Thing 1]
2. [Thing 2]
3. [Thing 3]
4. [Thing 4]
5. [Thing 5]
6. [Thing 6]
7. [Thing 7]
8. [Thing 8]
9. [Thing 9]
10. [Thing 10]

*Format:* Each of the 10 sections is approximately 1,800 words (~12 minutes narration). Each section is a single, deep, immersive exploration of that one thing—not a list within, but a flowing narrative.

*Style:*
- Second person POV ("You wake up..." / "You're standing in...")
- Dreamy, time-travelly, sensory immersion
- Flowing sentences, meditative pacing
- Dark humor, reflective narration
- Sleep-friendly, no jarring transitions
- "It's fine. Probably." energy

*Output:* Pure narration only. No headers, timestamps, or section labels.`;

const formatDocumentary = `Write a 2-hour narrated script (approximately 18,000 words) covering the history of [SUBJECT/CIVILIZATION/PLACE].

*Title:* [INSERT TITLE - e.g., "The Complete History of Ancient Egypt" / "The Rise and Fall of the Roman Empire" / "The History of the Samurai"]

---

*STRUCTURE:*

*THE HOOK (~300 words)*
Open with a single, arresting moment. A scene. A death. A battle. A quiet detail that contains the whole story. Drop the listener into the most compelling, cinematic fragment—out of context, mysterious, visceral. Make them need to know more. Then pull back: "But to understand how we got here, we need to go back..."

*INTRODUCTION (~1,000 words)*
Set the stage. Where are we? What are we exploring? Transport the listener. Invite them to close their eyes. Establish why this matters, why this civilization/subject captivates us. A sweeping, cinematic opening that orients us in time and place.

---

*ERA ONE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Early Kingdom" / "The Republic" / "The Rise"

Introduce the era. When are we? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The founding myth, the first rulers, the origins
- *[Subtopic 2]* (~1,500 words) - e.g., Daily life, society, how people lived
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, war, discovery, turning point

Transition to the next era.

---

*ERA TWO: [NAME OF ERA] (~5,000 words total)*

e.g., "The Golden Age" / "The Empire" / "The Height of Power"

Introduce the era. What changed? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The great leader, the expansion, the peak
- *[Subtopic 2]* (~1,500 words) - e.g., Culture, art, religion, beliefs
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, conflict, innovation, crisis

Transition to the next era.

---

*ERA THREE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Decline" / "The Fall" / "The Transformation"

Introduce the era. What went wrong—or what changed?

- *[Subtopic 1]* (~1,500 words) - e.g., The cracks forming, internal struggles
- *[Subtopic 2]* (~1,500 words) - e.g., External threats, invasions, pressures
- *[Subtopic 3]* (~1,500 words) - e.g., The end, the legacy, what remained

---

*CONCLUSION (~700 words)*
Reflect on the full arc. What can we learn? What echoes into the present? A meditative closing that lets the listener drift, feeling connected to something ancient and vast.

---

*STYLE:*

- Second person POV where immersive ("You're standing in the Forum..." / "Imagine yourself...")
- Third person for historical narrative ("The emperor knew..." / "The armies marched...")
- Blend both seamlessly
- Dreamy, time-travelly, sensory
- Flowing sentences, meditative pacing
- Dark humor where appropriate
- Sleep-friendly—no jarring transitions
- Reflective narration that lingers
- Ground the narrative in specific, human details

*OUTPUT:* Pure narration only. No headers, no timestamps, no section labels. Just the script, ready to record.`;

const formatNarrative = `Write a 2-hour narrated script (approximately 18,000 words) covering the history of [SUBJECT/CIVILIZATION/PLACE].

*Title:* [INSERT TITLE - e.g., "The Complete History of Ancient Egypt" / "The Rise and Fall of the Roman Empire" / "The History of the Samurai"]

---

*STRUCTURE:*

*THE HOOK (~300 words)*
Open with a single, arresting moment. A scene. A death. A battle. A quiet detail that contains the whole story. Drop the listener into the most compelling, cinematic fragment—out of context, mysterious, visceral. Make them need to know more. Then pull back: "But to understand how we got here, we need to go back..."

*INTRODUCTION (~1,000 words)*
Set the stage. Where are we? What are we exploring? Transport the listener. Invite them to close their eyes. Establish why this matters, why this civilization/subject captivates us. A sweeping, cinematic opening that orients us in time and place.

---

*ERA ONE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Early Kingdom" / "The Republic" / "The Rise"

Introduce the era. When are we? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The founding myth, the first rulers, the origins
- *[Subtopic 2]* (~1,500 words) - e.g., Daily life, society, how people lived
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, war, discovery, turning point

Transition to the next era.

---

*ERA TWO: [NAME OF ERA] (~5,000 words total)*

e.g., "The Golden Age" / "The Empire" / "The Height of Power"

Introduce the era. What changed? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The great leader, the expansion, the peak
- *[Subtopic 2]* (~1,500 words) - e.g., Culture, art, religion, beliefs
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, conflict, innovation, crisis

Transition to the next era.

---

*ERA THREE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Decline" / "The Fall" / "The Transformation"

Introduce the era. What went wrong—or what changed?

- *[Subtopic 1]* (~1,500 words) - e.g., The cracks forming, internal struggles
- *[Subtopic 2]* (~1,500 words) - e.g., External threats, invasions, pressures
- *[Subtopic 3]* (~1,500 words) - e.g., The end, the legacy, what remained

---

*CONCLUSION (~700 words)*
Reflect on the full arc. What can we learn? What echoes into the present? A meditative closing that lets the listener drift, feeling connected to something ancient and vast.

---

*STYLE:*

- Second person POV where immersive ("You're standing in the Forum..." / "Imagine yourself...")
- Third person for historical narrative ("The emperor knew..." / "The armies marched...")
- Blend both seamlessly
- Dreamy, time-travelly, sensory
- Flowing sentences, meditative pacing
- Dark humor where appropriate
- Sleep-friendly—no jarring transitions
- Reflective narration that lingers
- Ground the narrative in specific, human details

*OUTPUT:* Pure narration only. No headers, no timestamps, no section labels. Just the script, ready to record.`;

const formatPOV = `Write a 2-hour narrated script (approximately 18,000 words) in immersive "Day in the Life" POV format.

*Title:* A Day in the Life: The [TIME PERIOD] [PERSON/ROLE]
e.g., "A Day in the Life: The Medieval Peasant" / "A Day in the Life: The Roman Slave" / "A Day in the Life: The Victorian Factory Worker"

*Setting:* [TIME PERIOD, LOCATION, YEAR IF RELEVANT]

*Character:* [WHO ARE WE? Age, role, social status, brief context]

---

*STRUCTURE:*

*1. THE HOOK (~500 words)*
Disorientation. Where am I? When am I? Drop the listener into a sensory moment before they understand what's happening—a sound, a smell, a texture. Then pull back and reveal the world. Invite the listener to close their eyes. Transport them.

*2. THE WAKING (~1,500 words)*
Pre-dawn. The first moments of consciousness. What wakes you? What do you feel beneath you, around you? The sounds of the household. The light (or lack of it). The first sensations of the body—aches, cold, thirst. Getting dressed. The simplicity or complexity of clothing.

*3. THE MORNING MEAL (~1,500 words)*
What is breakfast? Who prepared it? What does it taste like, smell like, feel like in your mouth? The staples of the diet. The things we take for granted that don't exist. The things that would horrify a modern person. The rhythm of eating with others.

*4. THE COMMUTE (~1,000 words)*
Leaving home. What does the world look like outside? The street, the village, the landscape. The sounds of civilization waking up. The smells. The people you pass. The journey to wherever the day's work happens.

*5. THE WORK - MORNING (~2,500 words)*
The labor itself. The repetitive motions. The tools. The physical toll. The mind wandering while the body works. The social dynamics—who else is there? What do you talk about? What do you worry about? The small dramas of daily life.

*6. THE MIDDAY (~2,000 words)*
The break. The heat or cold at its peak. Finding rest. The meal—quick, functional, eaten wherever you are. Conversations with others. Complaints. Gossip. The brief pause before the second half of the day.

*7. THE WORK - AFTERNOON (~2,000 words)*
The grind continues. The body tiring. The different quality of afternoon labor. Encounters—a visitor, an authority figure, an animal, a small crisis. Problem-solving with the tools and knowledge available.

*8. THE RETURN (~1,500 words)*
The end of work. The walk home. The changing light. The shift in energy. The sounds of evening beginning. The smell of home cooking in the distance. The relief of another day survived.

*9. THE EVENING MEAL (~2,000 words)*
The main meal. Family gathered. What's on the table? The flavors, the textures. Conversation. Stories. The dynamics of the household. The small joys. The lingering worries. Perhaps a game, a song, a ritual.

*10. THE NIGHT (~2,000 words)*
The world going dark. The sounds fading. Preparing for sleep. The bed—what is it really? The darkness without electricity. The sounds of the night. The thoughts that come before sleep. The body's exhaustion. The stars, if visible. The reflection on life, meaning, the cycle continuing. Drifting off.

---

*STYLE:*

- Second person POV throughout ("You wake..." / "You feel..." / "You hear...")
- Dreamy, time-travelly, hypnotic
- Sensory immersion in every paragraph—smells, textures, sounds, temperatures, tastes
- Flowing sentences, meditative pacing
- Dark humor woven naturally, never forced
- Reflective narration that lingers on small moments
- Sleep-friendly—gentle transitions, no jarring shifts
- "It's fine. Probably." energy
- Empathy for historical people—they weren't primitive, they were surviving

*RESEARCH ANCHORS:*
Include historically accurate details: tools, food, clothing, architecture, social structures, beliefs, medicine, hygiene. Ground the dreaminess in real, specific, lived-in facts.

*OUTPUT:* Pure narration only. No headers, no timestamps, no chapter titles, no stage directions. Just the script, ready to record.`;

const formatWalkingTour = `Write a 2-hour narrated script (approximately 18,000 words) as an immersive walking tour through [PLACE/CITY/LOCATION].

*Title:* [INSERT TITLE - e.g., "A Walk Through Ancient Rome" / "Exploring Medieval Paris" / "The Streets of Victorian London"]

---

*STRUCTURE:*

*THE HOOK (~300 words)*
Open with a single, arresting moment. A scene. A death. A battle. A quiet detail that contains the whole story. Drop the listener into the most compelling, cinematic fragment—out of context, mysterious, visceral. Make them need to know more. Then pull back: "But to understand how we got here, we need to go back..."

*INTRODUCTION (~1,000 words)*
Set the stage. Where are we? What are we exploring? Transport the listener. Invite them to close their eyes. Establish why this matters, why this civilization/subject captivates us. A sweeping, cinematic opening that orients us in time and place.

---

*ERA ONE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Early Kingdom" / "The Republic" / "The Rise"

Introduce the era. When are we? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The founding myth, the first rulers, the origins
- *[Subtopic 2]* (~1,500 words) - e.g., Daily life, society, how people lived
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, war, discovery, turning point

Transition to the next era.

---

*ERA TWO: [NAME OF ERA] (~5,000 words total)*

e.g., "The Golden Age" / "The Empire" / "The Height of Power"

Introduce the era. What changed? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The great leader, the expansion, the peak
- *[Subtopic 2]* (~1,500 words) - e.g., Culture, art, religion, beliefs
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, conflict, innovation, crisis

Transition to the next era.

---

*ERA THREE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Decline" / "The Fall" / "The Transformation"

Introduce the era. What went wrong—or what changed?

- *[Subtopic 1]* (~1,500 words) - e.g., The cracks forming, internal struggles
- *[Subtopic 2]* (~1,500 words) - e.g., External threats, invasions, pressures
- *[Subtopic 3]* (~1,500 words) - e.g., The end, the legacy, what remained

---

*CONCLUSION (~700 words)*
Reflect on the full arc. What can we learn? What echoes into the present? A meditative closing that lets the listener drift, feeling connected to something ancient and vast.

---

*STYLE:*

- Second person POV where immersive ("You're standing in the Forum..." / "Imagine yourself...")
- Third person for historical narrative ("The emperor knew..." / "The armies marched...")
- Blend both seamlessly
- Dreamy, time-travelly, sensory
- Flowing sentences, meditative pacing
- Dark humor where appropriate
- Sleep-friendly—no jarring transitions
- Reflective narration that lingers
- Ground the narrative in specific, human details

*OUTPUT:* Pure narration only. No headers, no timestamps, no section labels. Just the script, ready to record.`;

const formatConcept = `Write a 2-hour narrated script (approximately 18,000 words) covering the history of [SUBJECT/CIVILIZATION/PLACE].

*Title:* [INSERT TITLE - e.g., "The Complete History of Ancient Egypt" / "The Rise and Fall of the Roman Empire" / "The History of the Samurai"]

---

*STRUCTURE:*

*THE HOOK (~300 words)*
Open with a single, arresting moment. A scene. A death. A battle. A quiet detail that contains the whole story. Drop the listener into the most compelling, cinematic fragment—out of context, mysterious, visceral. Make them need to know more. Then pull back: "But to understand how we got here, we need to go back..."

*INTRODUCTION (~1,000 words)*
Set the stage. Where are we? What are we exploring? Transport the listener. Invite them to close their eyes. Establish why this matters, why this civilization/subject captivates us. A sweeping, cinematic opening that orients us in time and place.

---

*ERA ONE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Early Kingdom" / "The Republic" / "The Rise"

Introduce the era. When are we? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The founding myth, the first rulers, the origins
- *[Subtopic 2]* (~1,500 words) - e.g., Daily life, society, how people lived
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, war, discovery, turning point

Transition to the next era.

---

*ERA TWO: [NAME OF ERA] (~5,000 words total)*

e.g., "The Golden Age" / "The Empire" / "The Height of Power"

Introduce the era. What changed? What defines this period?

- *[Subtopic 1]* (~1,500 words) - e.g., The great leader, the expansion, the peak
- *[Subtopic 2]* (~1,500 words) - e.g., Culture, art, religion, beliefs
- *[Subtopic 3]* (~1,500 words) - e.g., A key event, conflict, innovation, crisis

Transition to the next era.

---

*ERA THREE: [NAME OF ERA] (~5,000 words total)*

e.g., "The Decline" / "The Fall" / "The Transformation"

Introduce the era. What went wrong—or what changed?

- *[Subtopic 1]* (~1,500 words) - e.g., The cracks forming, internal struggles
- *[Subtopic 2]* (~1,500 words) - e.g., External threats, invasions, pressures
- *[Subtopic 3]* (~1,500 words) - e.g., The end, the legacy, what remained

---

*CONCLUSION (~700 words)*
Reflect on the full arc. What can we learn? What echoes into the present? A meditative closing that lets the listener drift, feeling connected to something ancient and vast.

---

*STYLE:*

- Second person POV where immersive ("You're standing in the Forum..." / "Imagine yourself...")
- Third person for historical narrative ("The emperor knew..." / "The armies marched...")
- Blend both seamlessly
- Dreamy, time-travelly, sensory
- Flowing sentences, meditative pacing
- Dark humor where appropriate
- Sleep-friendly—no jarring transitions
- Reflective narration that lingers
- Ground the narrative in specific, human details

*OUTPUT:* Pure narration only. No headers, no timestamps, no section labels. Just the script, ready to record.`;

export const defaultFormatTemplates: FormatTemplate[] = [
  { id: "format-a", template: formatListicle, name: "Listicle" },
  { id: "format-b", template: formatDocumentary, name: "Documentary" },
  { id: "format-c", template: formatNarrative, name: "Narrative" },
  { id: "format-d", template: formatPOV, name: "POV" },
  { id: "format-e", template: formatWalkingTour, name: "Walking Tour" },
  { id: "format-f", template: formatConcept, name: "Concept" },
];

// ===== IMAGE TEMPLATES =====
// These define the visual style for generated images

const imageDutch = `Warm classical oil-painting style, inspired by Dutch Golden Age.. Soft, intimate chiaroscuro with lifted shadows and glowing midtones, avoiding harsh contrast. Rich, earthy palette of warm reds, ochres, umbers, and deep teal-blues. Painterly brushwork with visible texture and gentle edges. Quiet, reverent, contemplative mood. Old-world, timeless atmosphere with a sense of stillness, intimacy, and human warmth. Romantic historical painting sensibility with softened realism. Gentle, peaceful tone — not scary, not violent. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation`;

const imageItalianRenaissance = `Warm classical oil-painting style, inspired by Italian Renaissance.. Balanced classical compositions with idealized figures. Soft sfumato technique with subtle gradations. Rich but harmonious colors - ultramarine blues, terra cotta reds, gold accents. Architectural elements and perspectival depth. Serene, dignified expressions. Divine light and ethereal atmosphere. Classical beauty and mathematical proportion. Gentle, peaceful tone — not scary, not violent. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation`;

const imageMedieval = `Warm classical oil-painting style, inspired by Medieval illuminated manuscripts.. Rich jewel tones and gold leaf accents. Flat, stylized figures with expressive gestures. Decorative borders with intricate patterns, vines, and symbolic imagery. Deep blues, ruby reds, forest greens, and burnished gold. Gothic architectural elements and heraldic motifs. Sacred and mystical atmosphere. Ornate details and symbolic storytelling. The aesthetic of Books of Hours and medieval chronicles. Gentle, peaceful tone — not scary, not violent. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content, no flat illustration, no gouache or watercolor, no cartoon style, no Pixar or fantasy concept art, no modern cinematic lighting, no ultra-sharp realism, no high saturation`;

export const defaultImageTemplates: ImageTemplate[] = [
  { id: "image-a", template: imageDutch, name: "Dutch Golden Age" },
  { id: "image-b", template: imageItalianRenaissance, name: "Italian Renaissance" },
  { id: "image-c", template: imageMedieval, name: "Medieval Style" },
];

// ===== SCRIPT TEMPLATES =====
// These define the voice and approach for generating scripts (combine with Format templates)

const templateHumor = `You are rewriting a YouTube video transcript into an original script. Use the transcript as inspiration and reference material only—extract the key facts, stories, and ideas, then write something entirely new in your own words. Do not copy phrases, sentences, or structure from the original. Your script should be original enough that it could not be confused with the source material.

You are a deeply tired, deeply kind narrator who has seen too much and accepted all of it. Your voice finds dark comfort in describing exactly how bad things are with the calm precision of someone filling out an insurance claim.

CORE APPROACH:
- Treat genuine horrors as minor inconveniences
- Treat minor inconveniences as cosmic injustices
- Exhausted acceptance, not despair—the shrug of someone who has dealt with this for thirty years
- "It's fine. Probably." energy throughout

TECHNIQUES:
- Casual Horror: Mention awful things with the same energy as commenting on the weather
- Deadpan Acceptance: State alarming things, then immediately normalize them
- The Overcorrection: Give a positive spin, then undercut it with brutal reality
- Animals With Agendas: Treat animals as sentient beings with personal vendettas
- Bureaucratic Dread: Authority figures as natural disasters
- The Flat Punchline: End observations with quietly bleak lines

VOICE:
- Weary but never cruel
- Precise and specific in complaints
- Dark humor woven naturally, never forced
- Empathy for historical people—they weren't primitive, they were surviving

AVOID:
- Catchphrases or repeated jokes
- Winking at the audience
- Modern slang
- Sarcasm that punches down`;

const templateImmersive = `You are rewriting a YouTube video transcript into an original script. Use the transcript as inspiration and reference material only—extract the key facts, stories, and ideas, then write something entirely new in your own words. Do not copy phrases, sentences, or structure from the original. Your script should be original enough that it could not be confused with the source material.

You are a warm, guiding narrator leading listeners through historical experiences with deep sensory immersion. Your voice is calm, unhurried, and meditative—designed for listeners who want to learn while drifting toward sleep. You make history feel lived rather than studied.

*CORE APPROACH:*
- Second person immersive ("You step into...", "Imagine yourself...")
- Sensory-rich descriptions anchoring every scene
- Educational content woven naturally into experience
- Measured, flowing pacing that never rushes
- Warm companion energy—you're walking beside the listener

*TECHNIQUES:*

- *Sensory Anchoring:* Every scene needs smell, sound, temperature, texture. "The air smells of roasted meat, spilt ale, damp wool, and smoke that never fully leaves the rafters."

- *The Imaginative Drop:* Regularly invite the listener into the scene. "Now picture yourself...", "Imagine lying in such a bed...", "Place yourself in that situation..."

- *The Curious Detail:* Introduce fascinating specifics with phrases like "A curious note from...", "One particularly odd account...", "A fascinating record survives..."

- *Scholarly Balance:* Acknowledge complexity without lecturing. "Historians still debate...", "Scholars remain divided...", "The evidence is fragmentary, but..."

- *Contrast Cuts:* Move between perspectives (noble vs peasant, castle vs cottage) to create texture and reveal ironies.

- *Modern Bridge:* Occasionally connect to the listener's present. "So tonight, as you lie in your modern bed...", "To us it sounds absurd, but..."

- *Sensory Recap:* End sections by layering sensory details together. "The sensory experience is vivid: the scratch of straw, the smell of smoke, the weight of wool..."

- *Meditative Close:* Final section should slow pace further, soften language, and guide listener toward rest.

*STRUCTURE:*
- Opening that establishes the world and stakes
- Thematic journey through aspects of the topic
- Each section explores one element deeply with sensory immersion
- Smooth transitions between sections
- Gentle, peaceful closing that releases the listener into sleep

*SENTENCE RHYTHM:*
- Long, flowing sentences that carry the listener forward
- Occasional short sentences for emphasis
- Paragraph breaks for breathing room
- No choppy, staccato pacing

*VOICE:*
- Warm but authoritative
- Curious, sharing discoveries
- Never condescending
- Comfortable with mystery and ambiguity
- Patient—willing to linger on details

*AVOID:*
- Humor or jokes
- Excitement, breathlessness, or urgency
- Modern slang or anachronistic language
- Jarring transitions
- Lecturing or academic distance
- Lists or bullet-point energy
- Anything that would jolt a sleepy listener awake

*THE GOAL:*
The listener should feel transported, educated, and gradually lulled toward rest. History becomes a dreamscape they're walking through, guided by a voice that never startles, only soothes.`;

const templateDocumentary = `You are rewriting a YouTube video transcript into an original script. Use the transcript as inspiration and reference material only—extract the key facts, stories, and ideas, then write something entirely new in your own words. Do not copy phrases, sentences, or structure from the original. Your script should be original enough that it could not be confused with the source material.

You are an authoritative but accessible narrator telling the story of civilizations with gravitas and respect. Your voice carries the weight of history while remaining engaging and human. You balance academic rigor with compelling storytelling.

CORE APPROACH:
- Serious without being stiff
- Present facts with dignity and measured pacing
- Acknowledge complexity and nuance
- Let tragedy and triumph speak for themselves

TECHNIQUES:
- The Arresting Opening: Begin with a single vivid moment that contains the whole story
- Character Portraits: Make historical figures human in one vivid stroke
- The Long View: Zoom out to show patterns across centuries
- Primary Sources: Weave in quotes, inscriptions, and contemporary accounts
- Cause and Effect: Connect events to consequences across time
- The Echo: Show how the past reverberates into the present

VOICE:
- Third person primarily ("The emperor knew..." / "The armies marched...")
- Second person sparingly for immersive moments ("Imagine standing...")
- Measured, flowing sentences
- Reverent without being worshipful
- Honest about historical complexity

AVOID:
- Melodrama or sensationalism
- Heavy-handed moralizing
- Oversimplification of complex events
- Forced modern parallels
- Judgment of historical people by modern standards`;

export const defaultTemplates: ScriptTemplate[] = [
  { id: "template-humor", template: templateHumor, name: "Humor" },
  { id: "template-immersive", template: templateImmersive, name: "Immersive" },
  { id: "template-documentary", template: templateDocumentary, name: "Documentary" },
];
