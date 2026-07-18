-- =====================================================================
-- Migration 0005 — Storage for listening audio
-- =====================================================================

-- Private bucket. The clips are paid content: a public bucket URL is
-- permanently scrapeable once anyone discovers it, so playback goes
-- through short-lived signed URLs instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listening-audio',
  'listening-audio',
  false,
  26214400,  -- 25 MB, matching the server action's validation
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Policies
--
-- No anon INSERT/UPDATE/DELETE policy exists, so uploads are denied by
-- default. The browser uploads with a one-shot SIGNED UPLOAD TOKEN that
-- the server mints after validating size and MIME type — the token
-- authorises that single object, not the bucket.
--
-- The service role bypasses RLS entirely, so server-side reads and the
-- signing calls need no policy of their own.
-- ---------------------------------------------------------------------

drop policy if exists "listening audio: authenticated read" on storage.objects;
create policy "listening audio: authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'listening-audio');

-- Housekeeping: drop the storage object when its clip row is deleted, so
-- a cascade-deleted batch does not leave orphaned MP3s billing forever.
create or replace function public.delete_audio_object()
returns trigger language plpgsql security definer set search_path = public, storage as $$
begin
  delete from storage.objects
  where bucket_id = 'listening-audio' and name = old.storage_path;
  return old;
end $$;

drop trigger if exists trg_audio_clip_delete on public.audio_clips;
create trigger trg_audio_clip_delete after delete on public.audio_clips
  for each row execute function public.delete_audio_object();
