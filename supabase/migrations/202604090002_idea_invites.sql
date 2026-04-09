create table if not exists public.idea_invites (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.organized_idea_shares(id) on delete cascade,
  idea_id uuid not null references public.organized_ideas(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  invite_token_hash text not null unique,
  role text not null default 'viewer' check (role in ('viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idea_invites_owner_idx
  on public.idea_invites(owner_user_id, created_at desc);

create index if not exists idea_invites_idea_idx
  on public.idea_invites(idea_id, created_at desc);

create index if not exists idea_invites_recipient_idx
  on public.idea_invites(lower(recipient_email));

create unique index if not exists idea_invites_pending_per_recipient
  on public.idea_invites(share_id, lower(recipient_email))
  where status = 'pending';

alter table public.idea_invites enable row level security;

drop policy if exists "owners can manage idea invites" on public.idea_invites;
create policy "owners can manage idea invites"
on public.idea_invites
for all
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);
