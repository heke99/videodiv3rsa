-- Seed the model and routing registries.
--
-- Everything lands as `candidate` with a licence that has not been reviewed.
-- Nothing here is routable until a human reviews the licence and promotes the
-- version, which is the fail-closed behaviour required by spec sections 65
-- and 85. Artifact hashes are recorded at provisioning time, not here.

insert into public.model_registry (model_id, family, display_name, kind, adapter, runtime, upstream_url) values
  ('wan2.2-t2v-a14b',    'wan',      'Wan2.2 T2V-A14B',    'video',     'WanAdapter',       'runtime-wan',        'https://github.com/Wan-Video/Wan2.2'),
  ('wan2.2-i2v-a14b',    'wan',      'Wan2.2 I2V-A14B',    'video',     'WanAdapter',       'runtime-wan',        'https://github.com/Wan-Video/Wan2.2'),
  ('wan2.2-s2v-14b',     'wan',      'Wan2.2 S2V-14B',     'video',     'WanAdapter',       'runtime-wan',        'https://github.com/Wan-Video/Wan2.2'),
  ('wan2.2-animate-14b', 'wan',      'Wan2.2 Animate-14B', 'video',     'WanAdapter',       'runtime-wan',        'https://github.com/Wan-Video/Wan2.2'),
  ('qwen-image-2',       'qwen',     'Qwen Image 2.x',     'image',     'QwenImageAdapter', 'runtime-qwen-image', 'https://github.com/QwenLM'),
  ('qwen3-tts',          'qwen',     'Qwen3-TTS',          'tts',       'QwenTTSAdapter',   'runtime-qwen-tts',   'https://github.com/QwenLM'),
  ('mmaudio',            'mmaudio',  'MMAudio',            'audio',     'MMAudioAdapter',   'runtime-mmaudio',    'https://github.com/hkchengrex/MMAudio'),
  ('musetalk',           'musetalk', 'MuseTalk',           'lipsync',   'MuseTalkAdapter',  'runtime-musetalk',   'https://github.com/TMElyralab/MuseTalk'),
  ('whisperx',           'whisperx', 'WhisperX',           'alignment', 'WhisperXAdapter',  'runtime-qc',         'https://github.com/m-bain/whisperX'),
  ('hunyuan-video',      'hunyuan',  'HunyuanVideo',       'video',     'HunyuanAdapter',   'runtime-hunyuan',    'https://github.com/Tencent/HunyuanVideo'),
  ('skyreels-v2',        'skyreels', 'SkyReels V2',        'video',     'SkyReelsAdapter',  'runtime-skyreels',   'https://github.com/SkyworkAI/SkyReels-V2'),
  ('ltx-video',          'ltx',      'LTX Video',          'video',     'LTXAdapter',       'runtime-ltx',        'https://github.com/Lightricks/LTX-Video')
on conflict (model_id) do nothing;

insert into public.model_licenses (model_id, license_name, commercial_use, status) values
  ('wan2.2-t2v-a14b',    'Apache-2.0',          true,  'pending_review'),
  ('wan2.2-i2v-a14b',    'Apache-2.0',          true,  'pending_review'),
  ('wan2.2-s2v-14b',     'Apache-2.0',          true,  'pending_review'),
  ('wan2.2-animate-14b', 'Apache-2.0',          true,  'pending_review'),
  ('qwen-image-2',       'Apache-2.0',          true,  'pending_review'),
  ('qwen3-tts',          'Apache-2.0',          true,  'pending_review'),
  ('mmaudio',            'MIT',                 true,  'pending_review'),
  ('musetalk',           'MIT',                 true,  'pending_review'),
  ('whisperx',           'BSD-4-Clause',        true,  'pending_review'),
  -- Territory restricted community licence: blocked until reviewed and cleared.
  ('hunyuan-video',      'Tencent Community',   false, 'blocked'),
  ('skyreels-v2',        'unreviewed',          false, 'unknown'),
  ('ltx-video',          'unreviewed',          false, 'unknown')
on conflict (model_id) do nothing;

insert into public.model_versions
  (model_id, version, lifecycle, required_profile, required_vram_gib, supported_precisions)
values
  ('wan2.2-t2v-a14b',    '2.2.0', 'candidate',       'GPU_PROFILE_ULTRA',    80, '{bf16,fp8}'),
  ('wan2.2-i2v-a14b',    '2.2.0', 'candidate',       'GPU_PROFILE_ULTRA',    80, '{bf16,fp8}'),
  ('wan2.2-s2v-14b',     '2.2.0', 'candidate',       'GPU_PROFILE_HIGH',     60, '{bf16,fp8}'),
  ('wan2.2-animate-14b', '2.2.0', 'candidate',       'GPU_PROFILE_HIGH',     60, '{bf16,fp8}'),
  ('qwen-image-2',       '2.0.0', 'candidate',       'GPU_PROFILE_STANDARD', 40, '{bf16}'),
  ('qwen3-tts',          '3.0.0', 'candidate',       'GPU_PROFILE_ECONOMY',  12, '{bf16,fp16}'),
  ('mmaudio',            '1.0.0', 'candidate',       'GPU_PROFILE_ECONOMY',  12, '{fp16}'),
  ('musetalk',           '1.5.0', 'candidate',       'GPU_PROFILE_ECONOMY',  10, '{fp16}'),
  ('whisperx',           '3.1.0', 'candidate',       'GPU_PROFILE_ECONOMY',   8, '{fp16}'),
  ('hunyuan-video',      '1.0.0', 'license_blocked', 'GPU_PROFILE_ULTRA',    80, '{bf16}'),
  ('skyreels-v2',        '2.0.0', 'candidate',       'GPU_PROFILE_HIGH',     60, '{bf16}'),
  ('ltx-video',          '0.9.0', 'candidate',       'GPU_PROFILE_STANDARD', 40, '{bf16}')
on conflict (model_id, version) do nothing;

insert into public.model_capabilities
  (model_version_id, generation_kind, max_duration_frames, accepts_reference_images, accepts_driving_audio, produces_audio)
select mv.id, c.kind, c.max_frames, c.refs, c.audio_in, c.audio_out
from public.model_versions mv
join (values
  ('wan2.2-t2v-a14b',    'text_to_video',       121, false, false, false),
  ('wan2.2-i2v-a14b',    'image_to_video',      121, true,  false, false),
  ('wan2.2-s2v-14b',     'speech_to_video',     121, true,  true,  false),
  ('wan2.2-animate-14b', 'character_animation', 121, true,  false, false),
  ('qwen-image-2',       'image',                 1, true,  false, false),
  ('qwen3-tts',          'text_to_speech',        0, false, false, true),
  ('mmaudio',            'video_to_audio',        0, false, false, true),
  ('musetalk',           'lipsync',             600, true,  true,  false),
  ('whisperx',           'alignment',             0, false, true,  false),
  ('hunyuan-video',      'text_to_video',       129, false, false, false),
  ('skyreels-v2',        'text_to_video',       257, true,  false, false),
  ('ltx-video',          'text_to_video',       257, true,  true,  true)
) as c(model_id, kind, max_frames, refs, audio_in, audio_out)
  on c.model_id = mv.model_id
on conflict (model_version_id, generation_kind) do nothing;

-- Routing rules. Highest priority wins; the router still refuses any match
-- whose licence is not approved, so these describe intent rather than grant it.
insert into public.routing_rules (id, priority, enabled, match, target, reason) values
  ('talking-creator', 100, true,
   '{"generation_kind":["speech_to_video"]}'::jsonb,
   '{"model_id":"wan2.2-s2v-14b","precision":"bf16","generation_profile":"s2v_standard","qc_profile":"AVATAR","skills":["wan-s2v-prompt","lip-sync-planner","creator-eye-contact"]}'::jsonb,
   'Speech driven motion is what S2V is for; driving audio comes from the aligned dialogue.'),

  ('character-animation', 95, true,
   '{"generation_kind":["character_animation"]}'::jsonb,
   '{"model_id":"wan2.2-animate-14b","precision":"bf16","generation_profile":"animate_standard","qc_profile":"REALISTIC","skills":["wan-animate-prompt","human-motion-director","character-identity-lock"]}'::jsonb,
   'Reference controlled character motion.'),

  ('identity-locked-i2v', 90, true,
   '{"generation_kind":["image_to_video","text_to_video"],"requires_identity_lock":true}'::jsonb,
   '{"model_id":"wan2.2-i2v-a14b","precision":"bf16","generation_profile":"i2v_quality","qc_profile":"REALISTIC","skills":["wan-i2v-prompt","character-identity-lock","face-consistency"]}'::jsonb,
   'Identity consistency is far more reliable from a keyframe than from text alone.'),

  ('product-fidelity-i2v', 88, true,
   '{"generation_kind":["image_to_video","text_to_video"],"requires_product_fidelity":true}'::jsonb,
   '{"model_id":"wan2.2-i2v-a14b","precision":"bf16","generation_profile":"i2v_quality","qc_profile":"PRODUCT","skills":["wan-i2v-prompt","product-identity","product-logo-preservation","product-text-preservation"]}'::jsonb,
   'Logo and pack text survive a keyframe far better than a text prompt.'),

  ('reference-i2v', 80, true,
   '{"generation_kind":["image_to_video"]}'::jsonb,
   '{"model_id":"wan2.2-i2v-a14b","precision":"bf16","generation_profile":"i2v_standard","qc_profile":"STANDARD","skills":["wan-i2v-prompt"]}'::jsonb,
   'Any shot that starts from a reference frame.'),

  ('cinematic-t2v', 70, true,
   '{"generation_kind":["text_to_video"],"quality_mode":["CINEMATIC"]}'::jsonb,
   '{"model_id":"wan2.2-t2v-a14b","precision":"bf16","generation_profile":"t2v_cinematic","qc_profile":"CINEMATIC","skills":["wan-t2v-prompt","camera-director","lighting-director","composition-director"]}'::jsonb,
   'Establishing and environment work with heavy camera and lighting control.'),

  ('default-t2v', 10, true,
   '{"generation_kind":["text_to_video"]}'::jsonb,
   '{"model_id":"wan2.2-t2v-a14b","precision":"bf16","generation_profile":"t2v_standard","qc_profile":"STANDARD","skills":["wan-t2v-prompt"]}'::jsonb,
   'Fallback for text to video where no reference control is needed.'),

  ('default-image', 10, true,
   '{"generation_kind":["image"]}'::jsonb,
   '{"model_id":"qwen-image-2","precision":"bf16","generation_profile":"image_quality","qc_profile":"STANDARD","skills":["qwen-image-prompt"]}'::jsonb,
   'Keyframes, references and storyboard frames.')
on conflict (id) do nothing;
