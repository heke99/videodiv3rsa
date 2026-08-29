"""Register the rest of the catalogue as drafts.

The spec names roughly two hundred skills. Registering all of them keeps the
catalogue honest about the full production design, and marking the unwritten
ones draft keeps the router from ever selecting something with no content.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def drafts(names: dict) -> dict:
    return {
        skill_id: dict(name=name, description=description, status="draft")
        for skill_id, (name, description) in names.items()
    }

PLANNING = drafts({
 "intent-classifier": ("Intent Classifier", "Decide what kind of video the user is asking for."),
 "brief-normalizer": ("Brief Normalizer", "Reduce a free-text request to the fields a brief needs."),
 "creative-director": ("Creative Director", "Choose the creative approach for a brief."),
 "concept-generator": ("Concept Generator", "Propose distinct creative concepts for one brief."),
 "script-writer": ("Script Writer", "Write the spoken script from a brief and a Scene Bible."),
 "script-editor": ("Script Editor", "Tighten a script to its duration without losing the point."),
 "pacing-planner": ("Pacing Planner", "Decide the rhythm of cuts across a piece."),
 "storyboard-director": ("Storyboard Director", "Turn a script into storyboard frames."),
 "scene-planner": ("Scene Planner", "Group the script into scenes with locations and time."),
 "shot-planner": ("Shot Planner", "Break scenes into shots the pipeline can generate."),
 "transition-planner": ("Transition Planner", "Choose how each cut joins the next shot."),
 "dependency-planner": ("Dependency Planner", "Derive the shot dependency graph from a plan."),
 "model-router": ("Model Router", "Choose a model per shot. Implemented in code, registered for visibility."),
 "render-strategy": ("Render Strategy", "Decide resolution, upscale and interpolation per project."),
 "reference-strategy": ("Reference Strategy", "Decide which references to create before generation."),
 "cost-aware-planner": ("Cost Aware Planner", "Plan within a GPU and credit budget."),
})

PROMPT = drafts({
 "qwen-image-edit-prompt": ("Qwen Image Edit Prompt Compiler", "Compile an image edit that changes only what was asked."),
 "lipsync-prompt": ("Lip Sync Prompt Compiler", "Compile the inputs for a lip sync repair pass."),
})

CINEMATIC = drafts({
 "exposure-director": ("Exposure Director", "Decide what is correctly exposed and what is allowed to clip."),
 "production-design": ("Production Design", "Decide what is in the space and what it says."),
 "wardrobe-director": ("Wardrobe Director", "Choose clothing that reads correctly on camera."),
 "depth-of-field-director": ("Depth of Field Director", "Decide what is sharp and what falls away."),
 "handheld-director": ("Handheld Director", "Specify handheld behaviour that reads as a person holding a camera."),
 "focus-director": ("Focus Director", "Decide where focus sits and when it moves."),
 "transition-director": ("Transition Director", "Design the join between two shots."),
 "establishing-shot-director": ("Establishing Shot Director", "Design a shot that explains a space quickly."),
 "insert-shot-director": ("Insert Shot Director", "Design a close detail shot that carries information."),
 "closeup-director": ("Close-up Director", "Design a close-up that holds identity and expression."),
})

REALISM = drafts({
 "natural-exposure": ("Natural Exposure", "Let highlights and shadows behave as a real sensor would."),
 "facial-asymmetry": ("Facial Asymmetry", "Introduce the asymmetry every real face has."),
 "motion-blur": ("Motion Blur", "Match blur to the movement and the implied shutter."),
 "focus-breathing": ("Focus Breathing", "Reproduce the slight framing shift a real lens makes when refocusing."),
 "sensor-character": ("Sensor Character", "Reproduce grain, rolloff and colour response of a real sensor."),
 "environment-naturalism": ("Environment Naturalism", "Make spaces look lived in rather than staged."),
})

IDENTITY = drafts({
 "hairstyle-consistency": ("Hairstyle Consistency", "Hold hair shape and behaviour across shots."),
 "voice-consistency": ("Voice Consistency", "Hold a character's voice identity across every line."),
 "object-persistence": ("Object Persistence", "Keep objects present across the shots that contain them."),
 "prop-persistence": ("Prop Persistence", "Keep handled props identical across a scene."),
 "background-consistency": ("Background Consistency", "Hold the background stable across a scene."),
 "lighting-continuity": ("Lighting Continuity", "Hold light direction and quality across a scene."),
 "camera-continuity": ("Camera Continuity", "Keep camera height and lens consistent within a scene."),
 "color-continuity": ("Colour Continuity", "Hold the palette across shots so a sequence reads as one piece."),
 "cross-shot-continuity": ("Cross Shot Continuity", "Check continuity across every shot in a scene at once."),
})

MOTION = drafts({
 "sitting-motion": ("Sitting Motion", "Make sitting and rising read as weight moving."),
 "standing-motion": ("Standing Motion", "Make standing still look alive rather than frozen."),
 "turn-motion": ("Turn Motion", "Lead a turn with the head so the body follows correctly."),
 "gaze-direction": ("Gaze Direction", "Point a subject's attention at something specific in the space."),
 "multi-person-blocking": ("Multi Person Blocking", "Arrange several people so anatomy and relationships hold."),
 "interaction-choreography": ("Interaction Choreography", "Choreograph two people touching or exchanging something."),
})

UGC = drafts({
 "ugc-script": ("UGC Script", "Write a creator script in a persona's own voice."),
 "performance-ad-structure": ("Performance Ad Structure", "Structure a piece for direct response."),
 "testimonial-writer": ("Testimonial Writer", "Write a testimonial that sounds like experience rather than copy."),
 "founder-script": ("Founder Script", "Write a founder-to-camera script."),
 "creator-casting": ("Creator Casting", "Choose a creator archetype that suits the product and audience."),
 "handheld-behavior": ("Handheld Behaviour", "Reproduce how a hand-held phone actually moves."),
 "product-interaction": ("Product Interaction", "Show a creator using a product naturally."),
 "unboxing": ("Unboxing", "Structure an unboxing so the reveal lands."),
 "social-proof": ("Social Proof", "Place evidence where it is believable rather than boastful."),
 "platform-framing": ("Platform Framing", "Frame for a specific platform's chrome and aspect."),
 "safe-zone-planner": ("Safe Zone Planner", "Plan layout around platform interface overlays."),
 "caption-style": ("Caption Style", "Style burned-in captions to match the platform and the piece."),
 "overproduced-ugc-judge": ("Overproduced UGC Judge", "Detect content that is too polished to read as a creator."),
})

AUDIO = drafts({
 "voice-casting": ("Voice Casting", "Choose a voice that fits the persona and the material."),
 "voice-design": ("Voice Design", "Design a new voice identity from a description."),
 "conversational-pacing": ("Conversational Pacing", "Pace dialogue as a conversation rather than a reading."),
 "breathing-planner": ("Breathing Planner", "Place audible breaths where a speaker would take them."),
 "room-tone": ("Room Tone", "Generate the continuous sound of an empty space."),
 "music-director": ("Music Director", "Choose music that supports the piece without competing."),
 "music-placement": ("Music Placement", "Decide where music enters, sits and leaves."),
 "audio-mixer": ("Audio Mixer", "Balance the tracks against each other."),
 "audio-mastering": ("Audio Mastering", "Prepare the final mix for delivery."),
 "dialogue-clarity": ("Dialogue Clarity", "Keep speech intelligible against everything else."),
 "audio-video-sync": ("Audio Video Sync", "Align audio to picture across the whole timeline."),
})

QUALITY = drafts({
 "scene-bible-judge": ("Scene Bible Judge", "Check a shot against the canonical entity descriptions."),
 "reality-judge": ("Reality Judge", "Judge whether footage reads as photographed."),
 "face-judge": ("Face Judge", "Judge facial structure and quality."),
 "anatomy-judge": ("Anatomy Judge", "Detect impossible or malformed bodies."),
 "physics-judge": ("Physics Judge", "Detect movement and contact that could not happen."),
 "background-judge": ("Background Judge", "Detect unstable or incoherent backgrounds."),
 "object-persistence-judge": ("Object Persistence Judge", "Detect objects appearing or vanishing."),
 "product-judge": ("Product Judge", "Compare a rendered product against its reference."),
 "logo-judge": ("Logo Judge", "Detect warped or incorrect logos."),
 "text-preservation-judge": ("Text Preservation Judge", "Detect garbled on-pack text."),
 "interaction-judge": ("Interaction Judge", "Judge contact between people and objects."),
 "camera-judge": ("Camera Judge", "Judge whether camera movement matches the plan."),
 "framing-judge": ("Framing Judge", "Judge framing against the shot's intent."),
 "lighting-judge": ("Lighting Judge", "Judge lighting against the plan and against realism."),
 "exposure-judge": ("Exposure Judge", "Detect clipped or crushed exposure."),
 "color-judge": ("Colour Judge", "Detect palette drift across shots."),
 "continuity-judge": ("Continuity Judge", "Detect continuity breaks across a scene."),
 "transition-judge": ("Transition Judge", "Judge whether a cut works."),
 "voice-consistency-judge": ("Voice Consistency Judge", "Detect a voice changing between lines."),
})

REPAIR = drafts({
 "reference-repair": ("Reference Repair", "Regenerate a reference that failed its QC."),
 "keyframe-repair": ("Keyframe Repair", "Regenerate a keyframe without regenerating the shot."),
 "shot-regeneration": ("Shot Regeneration", "Regenerate a shot with a corrected prompt and a new seed."),
 "local-image-repair": ("Local Image Repair", "Repair a region of a frame rather than the whole shot."),
 "identity-repair": ("Identity Repair", "Correct a shot whose subject drifted from canonical."),
 "product-repair": ("Product Repair", "Correct a shot whose product is wrong."),
 "motion-repair": ("Motion Repair", "Correct a shot that moved too little or incoherently."),
 "lip-sync-repair": ("Lip Sync Repair", "Repair mouth movement against the shipped audio."),
 "upscale-repair": ("Upscale Repair", "Re-run or reject an upscale that degraded the shot."),
})

OPERATIONS = drafts({
 "worker-drain": ("Worker Drain", "Take a GPU worker out of rotation safely."),
 "model-promotion": ("Model Promotion", "Move a model version through its promotion gates."),
 "canary-rollout": ("Canary Rollout", "Shift a fraction of traffic to a new model version."),
 "benchmark-runner": ("Benchmark Runner", "Run the golden suite against a model version."),
})

GOVERNANCE = drafts({
 "license-review": ("Licence Review", "Review a model licence and record the decision."),
 "rights-declaration": ("Rights Declaration", "Capture rights for an uploaded face, voice or asset."),
 "consent-check": ("Consent Check", "Verify consent before a likeness or voice is used."),
 "retention-policy": ("Retention Policy", "Apply retention rules to generated and uploaded media."),
 "training-data-governance": ("Training Data Governance", "Gate what may ever become training data."),
})

for category, skills in [
    ("planning", PLANNING), ("prompt", PROMPT), ("cinematic", CINEMATIC),
    ("realism", REALISM), ("identity", IDENTITY), ("motion", MOTION),
    ("ugc", UGC), ("audio", AUDIO), ("quality", QUALITY), ("repair", REPAIR),
    ("operations", OPERATIONS), ("governance", GOVERNANCE),
]:
    write_all(category, skills)
