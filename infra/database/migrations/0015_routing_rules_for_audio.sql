-- Routing rules for the work that is not a shot.
--
-- The registry has carried capability rows for text_to_speech, alignment,
-- video_to_audio and lipsync since 0011, and no rule ever pointed at them. So
-- the router could describe those models but never choose one, and the four
-- activities that need them had nothing to ask. These are the missing rules,
-- and like every rule in 0011 they describe intent rather than grant it: the
-- licence gate still refuses anything not reviewed and promoted.

insert into public.routing_rules (id, priority, enabled, match, target, reason) values
  ('default-tts', 10, true,
   '{"generation_kind":["text_to_speech"]}'::jsonb,
   '{"model_id":"qwen3-tts","precision":"bf16","generation_profile":"tts_standard","qc_profile":"STANDARD","skills":["speech-director","emotion-director","pronunciation-planner","pause-planner"]}'::jsonb,
   'Every spoken line in the film, at the voice identity the Scene Bible fixed.'),

  ('default-alignment', 10, true,
   '{"generation_kind":["alignment"]}'::jsonb,
   '{"model_id":"whisperx","precision":"fp16","generation_profile":"alignment_standard","qc_profile":"STANDARD","skills":["dialogue-timing"]}'::jsonb,
   'Word and phoneme timings, which the timeline and the captions are both built on.'),

  ('default-ambience', 10, true,
   '{"generation_kind":["video_to_audio"]}'::jsonb,
   '{"model_id":"mmaudio","precision":"fp16","generation_profile":"ambience_standard","qc_profile":"STANDARD","skills":["ambience-planner","room-tone"]}'::jsonb,
   'Room tone and ambience derived from the finished picture, ducked under speech.'),

  ('default-lipsync', 10, true,
   '{"generation_kind":["lipsync"]}'::jsonb,
   '{"model_id":"musetalk","precision":"fp16","generation_profile":"lipsync_standard","qc_profile":"AVATAR","skills":["lip-sync-planner","audio-video-sync"]}'::jsonb,
   'The lipsync repair action, which the repair classifier can already choose.')
on conflict (id) do nothing;
