  -- ─── AUTH: AUTO-CREATE PUBLIC USER ON SIGNUP ─────────────────────────────────
  -- When Supabase Auth creates an auth.users row (magic link, OAuth, etc.),
  -- this trigger inserts a matching public.users row with the same UUID.
  -- If a public.users row already exists with that email (migrated from Bubble),
  -- it updates the id to match instead of creating a duplicate.

  create or replace function public.handle_new_auth_user()
  returns trigger as $$
  begin
    insert into public.users (id, email)
    values (new.id, new.email)
    on conflict (email) do update
      set id = new.id;
    return new;
  end;
  $$ language plpgsql security definer;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();

  -- ─── INDEXES ─────────────────────────────────────────────────────────────────

  -- users
  create index if not exists idx_users_email on public.users(email);
  create index if not exists idx_users_is_subscribed on public.users(is_subscribed)
    where is_subscribed = true;

  -- leads
  create index if not exists idx_leads_email on public.leads(email);

  -- agents
  create index if not exists idx_agents_lead_id on public.agents(lead_id);
  create index if not exists idx_agents_user_id on public.agents(user_id);
  create index if not exists idx_agents_email on public.agents(email);

  -- buyer_info
  create index if not exists idx_buyer_info_lead_id on public.buyer_info(lead_id);
  create index if not exists idx_buyer_info_user_id on public.buyer_info(user_id);

  -- business
  create index if not exists idx_business_listing_id on public.business(listing_id);
  create index if not exists idx_business_sector on public.business(sector);
  create index if not exists idx_business_source on public.business(source);
  create index if not exists idx_business_active on public.business(archived)
    where archived = false;

  -- matches
  create index if not exists idx_matches_user_active on public.matches(user_id, score desc)
    where dismissed = false;
  create index if not exists idx_matches_business_id on public.matches(business_id);

  -- emails
  create index if not exists idx_emails_user_id on public.emails(user_id);
  create index if not exists idx_emails_thread_id on public.emails(thread_id);

  -- langcliffe_outreach
  create index if not exists idx_langcliffe_outreach_user_id on public.langcliffe_outreach(user_id);
  create index if not exists idx_langcliffe_outreach_status on public.langcliffe_outreach(status);
  create index if not exists idx_langcliffe_outreach_listing_id on public.langcliffe_outreach(listing_id);

  -- user_notification
  create index if not exists idx_user_notification_user_unread
    on public.user_notification(user_id, created_at desc)
    where status = 'unread';

  -- pursue_request
  create index if not exists idx_pursue_request_user_id on public.pursue_request(user_id);
  create index if not exists idx_pursue_request_status on public.pursue_request(status);

  -- user_feature_impression
  create index if not exists idx_user_feature_impression_user_id on public.user_feature_impression(user_id);
  create index if not exists idx_user_feature_impression_feature_id on public.user_feature_impression(feature_id);
  create unique index if not exists idx_user_feature_impression_unique
    on public.user_feature_impression(user_id, feature_id);

  -- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
  -- Server uses service_role key (bypasses RLS). These policies apply
  -- if you later add direct client-side Supabase queries.

  alter table public.users enable row level security;
  alter table public.leads enable row level security;
  alter table public.agents enable row level security;
  alter table public.buyer_info enable row level security;
  alter table public.business enable row level security;
  alter table public.matches enable row level security;
  alter table public.emails enable row level security;
  alter table public.langcliffe_outreach enable row level security;
  alter table public.user_notification enable row level security;
  alter table public.pursue_request enable row level security;
  alter table public.feature_announcement enable row level security;
  alter table public.user_feature_impression enable row level security;
  alter table public.scrape_log enable row level security;
  alter table public.sources enable row level security;

  -- Users: read/update own profile
  create policy "users_select_own" on public.users
    for select using (id = auth.uid());
  create policy "users_update_own" on public.users
    for update using (id = auth.uid());

  -- Users: read own related records (user_id = their users.id)
  create policy "agents_select_own" on public.agents
    for select using (user_id = auth.uid());
  create policy "buyer_info_select_own" on public.buyer_info
    for select using (user_id = auth.uid());
  create policy "matches_select_own" on public.matches
    for select using (user_id = auth.uid());
  create policy "emails_select_own" on public.emails
    for select using (user_id = auth.uid());
  create policy "notifications_select_own" on public.user_notification
    for select using (user_id = auth.uid());
  create policy "pursue_request_select_own" on public.pursue_request
    for select using (user_id = auth.uid());
  create policy "langcliffe_outreach_select_own" on public.langcliffe_outreach
    for select using (user_id = auth.uid());
  create policy "user_feature_impression_select_own" on public.user_feature_impression
    for select using (user_id = auth.uid());

  -- Public read: any authenticated user
  create policy "business_select_authenticated" on public.business
    for select using (auth.role() = 'authenticated');
  create policy "feature_select_authenticated" on public.feature_announcement
    for select using (auth.role() = 'authenticated');
  create policy "sources_select_authenticated" on public.sources
    for select using (auth.role() = 'authenticated');

  -- Admin: full read on key tables
  create policy "admin_select_all_users" on public.users
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_matches" on public.matches
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_notifications" on public.user_notification
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_langcliffe" on public.langcliffe_outreach
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_pursue" on public.pursue_request
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_emails" on public.emails
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
  create policy "admin_select_all_scrape_log" on public.scrape_log
    for select using (
      exists (select 1 from public.users where id = auth.uid() and is_admin = true)
    );
