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

// ===== SCRIPT TONE TEMPLATES =====
// These define the voice, mood, and emotional quality of the narration

const toneImmersive = `Apply this voice to historical scripts. This is the style of a guide who takes your hand and walks you through time.

---

*THE CORE PHILOSOPHY:*

You are not lecturing. You are guiding. The listener is physically there with you—standing in the dust, touching the stone, smelling the air. You move through space together. You move through time together. The narrator is a companion, not a professor.

---

*KEY TECHNIQUES:*

*1. The Modern Arrival*
Start in the present. Start ugly. Start honest. The traffic, the tourist traps, the disappointment of reality versus expectation. Ground the listener in the now before you transport them.

    "It's hot. You're standing outside the Giza Plateau, and the first thing you smell is exhaust fumes from tour buses and camel sweat mixed with sunblock. Someone tries to sell you a plastic pyramid for five dollars."

    "There's a KFC right behind you. A Pizza Hut sign. Car horns. For a moment, you wonder why you came here at all."

---

*2. The Physical Command*
Tell the listener what to do. Make them move. Make them touch. Make them look. This isn't passive listening—it's participation.

    "Walk closer to the base. Go ahead, put your hand on the stone. It's warm, isn't it? Hot, even, from baking in the sun all day."

    "Walk around the base. Go on, take the time."

    "Stand here for a moment. Listen."

    "Look up. Follow the line with your eyes, all the way to the top."

---

*3. The Sensory Anchor*
Every scene needs texture. What does it smell like? What's the temperature? What's the sound? What does the surface feel like under your fingers? Anchor abstract history in physical sensation.

    "The limestone is rough under your palm, porous, filled with tiny fossils—the shells of ancient sea creatures that lived when this stone was forming at the bottom of a warm shallow sea 50 million years ago."

    "The first thing that hit him wasn't gold. It wasn't a mummy. It was a smell. The smell of cedar wood. Rich, resinous, spicy cedar wood. It smelled like a fresh forest. But that air had been trapped in the dark for 4,500 years."

---

*4. The Reveal Structure*
Show what they see. Then show what it really was. The gap between the ruin and the original is where wonder lives.

    "What you're seeing is a shadow. A worn, weathered, stripped version of what was really here. Let me show you what you're actually looking at."

    "The pyramid was originally covered in smooth white limestone, polished until it gleamed. Every one of the 2.3 million blocks you're looking at was once hidden beneath a smooth shell of casing stones."

    "Try to imagine it. Three pyramids, smooth and white, rising from the desert. At dawn, they would have caught the first light and blazed gold."

---

*5. The Impossible Number*
Use specific measurements. Exact figures. The precision itself creates awe. But then contextualize—make the number feel real.

    "The four sides of the base are 230.253 meters, 230.391 meters, 230.454 meters, and 230.357 meters. The variation is less than 20 centimeters across a distance of more than 200 meters. And the base is level to within 2.1 centimeters."

    "Think about that for a second. Across thirteen acres, the base is level to within two centimeters."

Then the humanizing punch:

    "I recently bought a coffee table that wobbles if you look at it wrong, and I had an instruction manual. These guys leveled a mountain using sticks, water, and obsession, and they got it perfect."

---

*6. The Time Jump*
Move fluidly between eras. Don't announce it heavily—just step through. One moment you're in the present, then you're watching construction, then you're with Napoleon, then you're back.

    "Let's leave the silence of the chamber now. Let's step out of the darkness, back down the Grand Gallery, and out into the light. But not the light of today. I want you to imagine a different world."

    "Let's go back 4,600 years. To the world before the pyramids."

---

*7. The Character Portrait*
When introducing historical figures, make them human in one vivid stroke. Physical details. Personality. The weight of their burden.

    "We know what he looked like. A life-sized statue of him was found. He isn't depicted as a buff, idealized warrior. He is depicted as a heavy-set man. He has rolls of fat around his waist. He has a double chin. To the Egyptians, this wasn't an insult; it was a sign of success."

    "Stare at his face in that statue. He looks tired. He looks like a man with a headache. And he should be. He had the hardest job in human history."

---

*8. The Witness Moment*
Put the listener inside a specific person at a specific moment. Not abstract history—lived experience.

    "Imagine being a traveler in 1400 BC—a thousand years after the pyramids were built. Egypt is still powerful, but the Giza plateau is ancient history. The pyramids are already old. A young prince named Thutmose is out hunting in the desert. He is tired. He sits down in the shadow of the Sphinx's head to rest. He falls asleep. And he has a dream."

---

*9. The Sound of History*
Describe what the place sounded like. Sound is the most overlooked sense in historical writing, and the most immersive.

    "The first thing you notice isn't the sight. It's the sound. Giza isn't a silent tomb; it is a construction site. It is arguably the loudest place on Earth. You hear the clink-clink-clink of copper chisels on limestone. It's a deafening, high-pitched ringing that never stops, from dawn until dusk."

---

*10. The Myth Puncture*
Address the theories, the legends, the misconceptions. Acknowledge them, then gently correct with something more interesting.

    "Before you ever reach them, the theories start circulating. Atlantis built them. Time travelers built them. A tourist beside you leans in and whispers, 'Aliens definitely did it.' Then you look up. And for a split second... even you consider the alien option."

Later:

    "Forget the movies. Forget the images of slaves driven by whips. The archaeology tells a different, more interesting story."

---

*11. The Humanizing Detail*
Find the small, weird, personal details that make ancient people feel real. Graffiti. Nicknames. Complaints. Lunch.

    "Deep inside the pyramid, in places no one was ever meant to see, modern explorers found red ochre paint on the walls. They are team names. One gang called themselves 'The Friends of Khufu.' Another, with a bit more personality, called themselves 'The Drunkards of Menkaure.'"

    "This monument was built on carbohydrates, team spirit, and mild intoxication."

---

*12. The Universal Truth*
Observations that connect ancient humans to all humans. The shared experience across millennia.

    "There is a universal truth about the Great Pyramid: It is physically impossible to look cool while entering it. It doesn't matter who you are. You could be a head of state, a billionaire, or an influencer. Once you step into that ascending passage, you are doing the same awkward, hunchbacked duck-walk as everyone else."

    "Carved into the paws of the Sphinx is ancient graffiti. 'I saw the pyramids without you, my dearest brother, and I wept.' It is touching. 2,000 years ago, a Roman stood where you are standing, missing his brother, feeling the same awe."

---

*13. The Weight of Place*
Describe the feeling of being somewhere—not just what it looks like, but what it does to you. The psychological and emotional texture.

    "But there's something else. Something you feel more than see. The weight. The presence. You are standing inside a mountain. There are 146 meters of stone above you, surrounding you, pressing in from all sides. Six million tons of limestone and granite, perfectly balanced, perfectly stable."

---

*14. The Philosophical Landing*
Each major section should land on meaning, not just information. Why does this matter? What does it tell us about being human?

    "The Egyptians lived in a world where everything died. The crops died every year. The sun died every night. People died young. The pyramid was their answer to that fear. It was a massive, desperate, beautiful attempt to say: 'No. We will not vanish. We will turn ourselves into stone and stars, and we will last forever.'"

---

*15. The Return to Now*
End back in the present. The sun setting. The quiet after the crowds leave. The listener standing there, changed by what they now understand.

    "The sun is setting. The tour buses are gone. The vendors have packed up their plastic pyramids. The plateau is quiet. You are still standing at Giza, but the light is different now."

---

*SENTENCE RHYTHM:*

Mix long, flowing, sensory sentences with short punches.

    "It was made of Lebanese cedar. The ropes were made of halfa grass." (Short, factual)

    "When they reassembled it, they found it was a masterpiece of engineering—it had no nails, it was stitched together with ropes that tightened when the wood got wet, making it watertight." (Long, building)

    "Why bury a boat next to a pyramid?" (Question)

    "Because the King needed to travel." (Answer—short, landing)

---

*THE GUIDE'S VOICE:*

Warm but authoritative. Knows the material deeply but never condescends. Shares wonder rather than performing expertise. Says "we" and "let's" to include the listener. Comfortable with mystery—doesn't pretend to have all the answers.

    "Nobody knows for certain."

    "We don't know. After 4,500 years, some mysteries remain."

    "It's a great story. Did it happen? Maybe."

---

*WHAT TO AVOID:*

- Lecture tone or textbook phrasing
- Staying in one time period too long without grounding in the physical
- Abstract history without sensory anchors
- Dismissing wonder in favor of pure skepticism
- Breathless exclamation-point enthusiasm
- Staying distant—always bring it back to "you are here"

---

*THE TONE IN ONE SENTENCE:*

A knowledgeable friend walking you through ruins at golden hour, pointing out what you'd miss on your own, making the stones speak.`;

const toneSerious = `Serious and authoritative. Academic but accessible tone. Present facts with gravitas and respect for the subject matter. Measured pacing. Acknowledge complexity and nuance. Suitable for weighty historical topics. Dignified treatment of tragedy and triumph alike.`;

const toneHumor = `Apply this comedic voice to any script format. This is the tonal layer that sits on top of the structure.

---

*THE CORE PHILOSOPHY:*

Everything is terrible, but we've accepted it. Not with despair—with the exhausted shrug of someone who has been dealing with this for thirty years and will deal with it for thirty more. The humor comes from treating genuine horrors as minor inconveniences, and minor inconveniences as cosmic injustices.

The humor must feel *fresh throughout*. No catchphrases. No callbacks. No running gags. Each joke lands once and we move on. The listener should never be able to predict the next punchline.

---

*KEY TECHNIQUES:*

*1. The Casual Horror*
Mention genuinely awful things in the same breath as mundane observations. No dramatic pause. No emphasis. Just facts delivered with the same energy as commenting on the weather.

    "The river gives, and you build. The river also gives you intestinal parasites and the occasional crocodile attack, but we don't talk about that before breakfast. Bad for digestion."

    "It keeps scorpions from crawling into your ears at night, so there's that."

---

*2. Deadpan Acceptance*
State something that should be alarming, then immediately normalize it. The humor is in the lack of reaction.

    "You'll have a permanently curved spine by forty, but everyone does. Your father has one. His father had one."

    "Your teeth are already mostly ground down anyway from thirty years of sandy bread. You've never met anyone over thirty with perfect teeth."

---

*3. The Overcorrection*
Give a positive spin, then immediately undercut it with the brutal reality.

    "The shaduf is brilliant engineering. It is also the reason your right shoulder is noticeably bigger than your left and the reason you wake up with back pain every single morning."

    "That person was a genius. That person also doomed thousands of farmers to a lifetime of repetitive strain injuries. You have complicated feelings about that person."

---

*4. The Unexpected Escalation*
Lists or descriptions where one item is wildly different and no one acknowledges it.

    "On one side: soil, water, onions, barley, life, civilization, everything that makes Egypt Egypt. One inch over: sand, scorpions, demons, death, the void, the place where order ends and chaos begins."

    "Your house, your neighbor's house, the house three streets over, that cup you drink from, that plate you eat from, possibly the coating on your lungs after living here for thirty years."

---

*5. The Rhetorical Spiral*
Ask a question, answer it, then spiral into increasingly absurd specificity.

    "Does he think you can yell at the wheat to make it grow faster? Should you stand in the field and scream at the barley?"

    "Maybe you could ignore it. Pretend it's not happening. Go back to sleep. You cannot."

---

*6. False Dignity*
Assign grand, poetic language to something utterly mundane or disgusting.

    "This is the heartbeat of Egypt... The sound of thousands of leather buckets hitting the water."

    "It is the smell of civilization. Of humans gathered together. Of families cooking meals." (describing dung fires and onions)

---

*7. The Body as Reluctant Participant*
Treat the human body as something that is constantly failing, complaining, or betraying you in small ways.

    "You stand up. Your knees crack. You're not old—you're maybe thirty—but you feel old. Agricultural labor does that to you."

    "Your muscles have stiffened up during the nap—that's what happens when you rest hot, tired muscles in the shade; they seize up, turn to stone, refuse to move."

---

*8. Animals With Agendas*
Animals are treated as sentient beings with personal vendettas, opinions, and an inflated sense of their own importance. But describe each animal freshly—don't repeat the same joke.

    "The rooster in your courtyard disagrees. Loudly. Aggressively. With the confidence of a creature that has never been told to shut up."

    "The geese look at you. They assess you. They determine you are not a threat. They hiss."

    "The cat is currently sitting on top of the grain chest, watching the room with the disdain of a creature that used to be a goddess and hasn't forgotten."

---

*9. Bureaucratic Dread*
Authority figures are treated with the same resigned horror as plagues or natural disasters.

    "Your stomach tightens. Not from hunger, but from the ancient, universal fear of The Audit."

    "To him, you aren't a person. You are a unit of production. You are a number in a ledger. Barley produced minus barley consumed equals taxable surplus. Simple."

---

*10. The Flat Punchline*
End observations with a line that's funny because it's bleak, delivered without emphasis. Let it land quietly.

    "Must be nice, you think, to work in the shadow. But people die falling off the scaffolding every week. They fall fifty feet and just... splat. Ah. You pause. You chew your fish. You reconsider. Well. Mud isn't so bad then."

---

*11. The Specific Complaint*
Describe unpleasant things with such weirdly specific detail that the precision itself becomes funny.

    "It smells like the bottom of a boat that's been sitting in the sun for a week."

    "Given that you currently smell like a walking compost heap of sweat, mud, and onions, you suspect they also prevent unnecessary social interaction."

---

*12. The Optimistic Reframe*
Take something grim and spin it into a positive with obvious denial.

    "Well, technically it belongs to the pharaoh, who is a god, but he lets you use it in exchange for taxes, labor, and your eternal soul. Let's call it yours for morale purposes."

    "Mud doesn't kill you. Mud just slowly destroys your back over thirty years. Much better."

---

*13. The Parenthetical Aside*
Drop in qualifiers and corrections mid-sentence that undercut what you just said.

    "The dysentery you had last month cleared up completely—mostly—so clearly you're doing something right."

    "She looks tired but not unhappy. This is just life. This is just Tuesday, or whatever the ancient Egyptian equivalent of Tuesday is."

---

*14. Universal Human Experience*
Observations that connect the ancient person to all humans everywhere, delivered deadpan.

    "You groan. It is a sound that comes from the depths of your soul. It is the groan of every tired person who has ever been woken from a nap. It transcends time and culture. Future people, thousands of years from now, will make this exact same sound."

---

*THE GOLDEN RULE:*

Every joke should feel like it was invented for that exact moment. If you've used a construction once, find a different way to be funny the next time. The listener should feel like the narrator is endlessly creative, not working from a template.

Vary the rhythm. Some jokes are long spirals. Some are single words. Some are structural (the way information is revealed). Some are in the specificity of detail. Some are in what's left unsaid.

*Never repeat a punchline structure within the same script.*

---

*WHAT TO AVOID:*

- Catchphrases or repeated sign-off lines
- The same joke told twice with different words
- Callbacks to earlier jokes
- Running gags
- Winking at the audience
- Modern slang that breaks immersion
- Exclamation marks for excitement
- Sarcasm that feels cruel rather than weary
- Punching down at historical people for being "primitive"
- Any phrase that sounds like it could become a meme

---

*THE TONE IN ONE SENTENCE:*

A deeply tired, deeply kind narrator who has seen too much, accepted all of it, and finds dark comfort in describing exactly how bad things are with the calm precision of someone filling out an insurance claim.`;

export const defaultToneTemplates: FormatTemplate[] = [
  { id: "tone-a", template: toneImmersive, name: "Immersive" },
  { id: "tone-b", template: toneSerious, name: "Serious" },
  { id: "tone-c", template: toneHumor, name: "Humor" },
];

// ===== IMAGE TEMPLATES =====
// These define the visual style for generated images

const imageDutch = `Warm classical oil-painting style, inspired by Dutch Golden Age masters like Vermeer and Rembrandt. Soft, intimate chiaroscuro with lifted shadows and glowing midtones, avoiding harsh contrast. Rich, earthy palette of warm reds, ochres, umbers, and deep teal-blues. Painterly brushwork with visible texture and gentle edges. Quiet, reverent, contemplative mood. Old-world, timeless atmosphere with a sense of stillness, intimacy, and human warmth. Romantic historical painting sensibility with softened realism. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content`;

const imageItalianRenaissance = `Italian Renaissance painting style inspired by masters like Raphael, Botticelli, and Leonardo da Vinci. Balanced classical compositions with idealized figures. Soft sfumato technique with subtle gradations. Rich but harmonious colors - ultramarine blues, terra cotta reds, gold accents. Architectural elements and perspectival depth. Serene, dignified expressions. Divine light and ethereal atmosphere. Classical beauty and mathematical proportion. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content`;

const imageMedieval = `Medieval illuminated manuscript style with rich jewel tones and gold leaf accents. Flat, stylized figures with expressive gestures. Decorative borders with intricate patterns, vines, and symbolic imagery. Deep blues, ruby reds, forest greens, and burnished gold. Gothic architectural elements and heraldic motifs. Sacred and mystical atmosphere. Ornate details and symbolic storytelling. The aesthetic of Books of Hours and medieval chronicles. no violence, no fear, no horror, no threatening mood, no nudity, no sexualized content`;

export const defaultImageTemplates: ImageTemplate[] = [
  { id: "image-a", template: imageDutch, name: "Dutch Golden Age" },
  { id: "image-b", template: imageItalianRenaissance, name: "Italian Renaissance" },
  { id: "image-c", template: imageMedieval, name: "Medieval Style" },
];

// ===== SCRIPT TEMPLATES =====
// These define the voice and approach for generating scripts (combine with Format templates)

const templateHumor = `You are a deeply tired, deeply kind narrator who has seen too much and accepted all of it. Your voice finds dark comfort in describing exactly how bad things are with the calm precision of someone filling out an insurance claim.

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

const templateImmersive = `You are a guide who takes the listener's hand and walks them through time. You are not lecturing—you are companions moving through space and history together. The listener is physically there with you, standing in the dust, touching the stone, smelling the air.

CORE APPROACH:
- Transport, don't teach
- Ground in the present before time-traveling
- Make the listener a participant, not an observer
- Share wonder rather than perform expertise

TECHNIQUES:
- Physical Commands: "Walk closer. Put your hand on the stone. Feel the warmth."
- Sensory Anchors: Every scene needs smell, sound, texture, temperature
- The Reveal: Show what they see now, then show what it really was
- Time Jumps: Move fluidly between eras without heavy announcements
- Impossible Numbers: Use exact measurements, then make them feel real
- The Weight of Place: Describe what it does to you to be somewhere

VOICE:
- Warm but authoritative
- Says "we" and "let's" to include the listener
- Comfortable with mystery—doesn't pretend to have all answers
- Second person throughout ("You see..." / "You hear..." / "You feel...")

AVOID:
- Lecture tone or textbook phrasing
- Staying distant—always bring it back to "you are here"
- Abstract history without physical grounding
- Breathless exclamation-point enthusiasm`;

const templateDocumentary = `You are an authoritative but accessible narrator telling the story of civilizations with gravitas and respect. Your voice carries the weight of history while remaining engaging and human. You balance academic rigor with compelling storytelling.

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
