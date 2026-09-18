-- Bug: editing a prospect you created, after the owner reassigned it to
-- someone else, silently failed to save. The UPDATE policy's `using` clause
-- (which rows you can target) already lets the creator edit their own leads
-- even after reassignment, but the `with check` clause (which validates the
-- row AFTER the edit) never accounted for created_by -- so ANY save on such
-- a row, even one that never touches assigned_to, was rejected by Postgres.
-- For inline edits routed through the outbox, the optimistic UI update made
-- it look saved, then silently reverted once the rejection came back --
-- exactly the "it's not saving" symptom reported.
--
-- Fix: with check only needs to confirm org_id. The actual reassignment
-- rule ("only the owner can hand a prospect to a *different* teammate;
-- anyone with edit rights can still release it back to the pool") moves
-- into a BEFORE UPDATE trigger, which can compare old vs new assigned_to --
-- something a plain RLS with check clause can't do.

drop policy if exists "prospects: update own or owner" on public.prospects;

create policy "prospects: update own or owner" on public.prospects
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (org_id = public.my_org_id());

create or replace function public.guard_prospect_reassignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_owner()
     and new.assigned_to is distinct from old.assigned_to
     and new.assigned_to is not null
     and new.assigned_to <> auth.uid() then
    raise exception 'Only the owner can assign a prospect to another teammate';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prospects_guard_reassignment on public.prospects;

create trigger trg_prospects_guard_reassignment
  before update on public.prospects
  for each row execute function public.guard_prospect_reassignment();
