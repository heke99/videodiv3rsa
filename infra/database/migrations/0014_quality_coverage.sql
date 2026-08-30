-- How much of the profile an evaluation actually managed to check.
--
-- `passed` on its own is not a claim we can honestly make while half the panel
-- needs a GPU we do not have. A UGC shot gates on identity, lip_sync, hands and
-- product; with only the measured judges running, none of those four is looked
-- at, and the row still says passed. Recording coverage alongside it is what
-- lets the editor say "passed the checks we could run" instead.
--
-- Nullable on purpose: rows written before this column existed genuinely do not
-- know their coverage, and defaulting them to 1 would assert the one thing this
-- column exists to stop us asserting.

alter table public.quality_evaluations
  add column if not exists coverage numeric
    check (coverage is null or (coverage >= 0 and coverage <= 1));

comment on column public.quality_evaluations.coverage is
  'Fraction of the quality profile''s gating dimensions that could be measured. '
  'Null means unknown, which is not the same as complete.';
