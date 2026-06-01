# Supabase Setup Guide

Since you requested to connect the application to Supabase, follow these steps to set up the necessary database tables and authentication.

## 1. Environment Variables

In the AI Studio "Secrets" (or environment settings), add the following variables:
- `VITE_SUPABASE_URL`: Your Supabase project URL (found in Project Settings -> API)
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anon public key (found in Project Settings -> API)
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service_role secret key (found in Project Settings -> API, needed for backend uploads updating the database)

## 2. Table Creation

Open the **SQL Editor** in your Supabase dashboard and run the following commands to create the necessary tables:

```sql
-- Create users table
create table public.users (
  id uuid references auth.users not null primary key,
  email text,
  name text,
  role text default 'member',
  "personalTarget" integer default 100,
  "uploadedCount" integer default 0,
  "createdAt" bigint,
  "lastSyncedAt" bigint,
  "driveFolderId" text
);

-- Create teamSettings table
create table public."teamSettings" (
  id text primary key,
  "totalUploaded" integer default 0,
  "overallTarget" integer default 0,
  "updatedAt" bigint
);

-- Create uploads table
create table public.uploads (
  id uuid default gen_random_uuid() primary key,
  "userId" uuid references public.users(id),
  "fileName" text,
  "driveFileId" text,
  "uploadedAt" bigint
);

-- Create attendance table
create table public.attendance (
  id uuid default gen_random_uuid() primary key,
  "userId" uuid references public.users(id),
  date text not null,
  status text default 'present',
  "recordedAt" bigint
);

-- Create jobs table
create table public.jobs (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  "assignedTo" uuid references public.users(id),
  "createdBy" uuid references public.users(id),
  "dueDate" bigint,
  priority text default 'medium',
  status text default 'pending',
  "createdAt" bigint
);

-- Insert initial team settings
insert into public."teamSettings" (id, "totalUploaded", "overallTarget", "updatedAt") 
values ('info', 0, 10000, extract(epoch from now()) * 1000);
```

## 3. Realtime Updates

To make the UI update in real-time, you need to enable Postgres changes on the `teamSettings`, `uploads`, and `attendance` tables.

1. Go to **Database > Replication** or **Table Editor > Table Settings**.
2. Make sure `public."teamSettings"`, `public.users`, `public.uploads`, and `public.attendance` are added to the Publication so that `supabase.channel` can listen to their changes.

## 4. Row Level Security (RLS)

If you enable RLS on the tables, make sure you configure proper policies:

```sql
-- Enable RLS
alter table public.users enable row level security;
alter table public."teamSettings" enable row level security;
alter table public.uploads enable row level security;
alter table public.jobs enable row level security;
alter table public.attendance enable row level security;

-- Users can read all users (needed for Leaderboard)
create policy "Users can view all members" on public.users for select using (true);

-- Users can update their own profile
create policy "Users can update own profile" on public.users for update using (auth.uid() = id);

-- Anyone can read teamSettings
create policy "Anyone can view team settings" on public."teamSettings" for select using (true);

-- Users can view all uploads
create policy "Anyone can view uploads" on public.uploads for select using (true);

-- Attendance policies
create policy "Anyone can view attendance" on public.attendance for select using (true);
create policy "Users can insert own attendance" on public.attendance for insert with check (auth.uid() = "userId");

-- Jobs policies
create policy "Anyone can view jobs" on public.jobs for select using (true);
create policy "Anyone can insert jobs" on public.jobs for insert with check (auth.uid() is not null);
create policy "Anyone can update jobs" on public.jobs for update using (auth.uid() is not null);
create policy "Anyone can delete jobs" on public.jobs for delete using (auth.uid() is not null);
```

Since the node script (`server.ts`) updates the database using the `SUPABASE_SERVICE_ROLE_KEY`, it bypasses RLS for inserting uploads.
