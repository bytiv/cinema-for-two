# 🎬 CinemaForTwo

A cozy, private movie streaming platform built for two people to upload, browse, and watch movies together in perfect sync — just like TeleParty, but built right in.

## Features

- **Movie Streaming** — Upload and stream movies from Azure Blob Storage
- **Watch Together** — Synchronized playback (play/pause/seek) via Supabase Realtime
- **Ephemeral Chat** — Chat while watching, with emoji reactions (messages aren't stored)
- **Floating Postcards** — Cute polaroid-style photos that float on the home page (max 5 per user)
- **User Profiles** — Avatar, name, watch history
- **Movie Management** — Upload, browse, search, delete (uploader only)
- **Watch History** — Track what you've watched and with whom
- **Mobile Responsive** — Works on mobile, optimized for desktop

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS, Framer Motion |
| Auth & DB | Supabase (Auth, PostgreSQL, Realtime) |
| File Storage | Azure Blob Storage (movies, posters, avatars, postcards) |
| Hosting | Vercel |

---

## Project Structure

```
cinema-for-two/
├── src/
│   ├── app/                      # Next.js App Router pages
│   │   ├── page.tsx              # Landing page (home)
│   │   ├── layout.tsx            # Root layout
│   │   ├── auth/
│   │   │   ├── login/page.tsx    # Login page
│   │   │   └── signup/page.tsx   # Signup page
│   │   ├── browse/page.tsx       # Movie catalog
│   │   ├── movie/[id]/page.tsx   # Movie detail
│   │   ├── watch/[id]/room/[roomId]/page.tsx  # Video player + sync room
│   │   ├── upload/page.tsx       # Upload movie
│   │   ├── profile/page.tsx      # User profile + postcards
│   │   └── api/                  # API routes
│   │       ├── auth/callback/    # Supabase auth callback
│   │       ├── movies/           # Movie CRUD + streaming
│   │       ├── rooms/            # Watch room management
│   │       └── upload/sas/       # Azure SAS URL generation
│   ├── components/               # Reusable components
│   │   ├── ui/                   # Button, Input
│   │   ├── layout/               # Navbar
│   │   ├── movie/                # MovieCard
│   │   ├── watch/                # VideoPlayer, ChatPanel
│   │   └── postcards/            # FloatingPostcards
│   ├── hooks/                    # Custom hooks
│   │   └── useWatchRoom.ts       # Realtime sync hook
│   ├── lib/                      # Utility libraries
│   │   ├── supabase/             # Supabase clients (browser, server, middleware)
│   │   ├── azure-blob.ts         # Azure Blob Storage utilities
│   │   └── utils.ts              # Helper functions
│   ├── styles/globals.css        # Global styles + theme
│   └── types/index.ts            # TypeScript types
├── public/                       # Static assets
├── supabase-schema.sql           # Database schema (run in Supabase SQL Editor)
├── .env.local                    # Environment variables (template)
├── tailwind.config.ts            # Tailwind theme configuration
└── package.json
```

---

## Setup Guide

### Prerequisites

- Node.js 18+
- A Supabase account (free tier works)
- An Azure account with a Storage Account
- A Vercel account (for deployment)

---

### Step 1: Clone & Install

```bash
git clone <your-repo-url>
cd cinema-for-two
npm install
```

---

### Step 2: Supabase Setup

1. **Create a new project** at [app.supabase.com](https://app.supabase.com)

2. **Run the database schema**:
   - Go to **SQL Editor** → **New Query**
   - Paste the entire contents of `supabase-schema.sql`
   - Click **Run**

3. **Get your API keys**:
   - Go to **Settings** → **API**
   - Copy:
     - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
     - `anon/public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`

4. **Configure Auth**:
   - Go to **Authentication** → **URL Configuration**
   - Set **Site URL** to `http://localhost:3000` (or your production URL)
   - Add `http://localhost:3000/api/auth/callback` to **Redirect URLs**
   - For production, also add: `https://your-domain.vercel.app/api/auth/callback`

5. **Enable Realtime**:
   - Go to **Database** → **Replication**
   - Enable realtime for `watch_rooms` and `watch_room_participants`
   - (The SQL script attempts this, but verify it's enabled)

6. **Optional: Disable email confirmation** (for testing):
   - Go to **Authentication** → **Providers** → **Email**
   - Toggle off "Confirm email"

---

### Step 3: Azure Blob Storage Setup

1. **Create a Storage Account**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Search "Storage accounts" → **+ Create**
   - Choose your subscription & resource group
   - Pick a unique name (e.g., `cinemafortwo`)
   - Region: closest to you
   - Performance: Standard
   - Redundancy: LRS (cheapest)
   - Click **Review + Create** → **Create**

2. **Get Access Keys**:
   - Go to your Storage Account → **Access keys**
   - Copy:
     - `Storage account name` → `AZURE_STORAGE_ACCOUNT_NAME`
     - `Key` (key1) → `AZURE_STORAGE_ACCOUNT_KEY`
     - `Connection string` (key1) → `AZURE_STORAGE_CONNECTION_STRING`

3. **Configure CORS** (required for browser uploads):
   - Go to **Resource sharing (CORS)** under Settings
   - Add a rule:
     - **Allowed origins**: `http://localhost:3000` and your production URL
     - **Allowed methods**: `GET, PUT, OPTIONS, HEAD`
     - **Allowed headers**: `*`
     - **Exposed headers**: `*`
     - **Max age**: `3600`

4. **Containers are auto-created** by the app, but you can manually create them:
   - `movies` — for movie files
   - `posters` — for movie poster images
   - `postcards` — for floating postcard images
   - `avatars` — for user profile photos

---

### Step 4: Environment Variables

Copy `.env.local` and fill in your values:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Azure
AZURE_STORAGE_ACCOUNT_NAME=cinemafortwo
AZURE_STORAGE_ACCOUNT_KEY=xxx...
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=cinemafortwo;AccountKey=xxx;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER_MOVIES=movies
AZURE_STORAGE_CONTAINER_POSTERS=posters
AZURE_STORAGE_CONTAINER_POSTCARDS=postcards
AZURE_STORAGE_CONTAINER_AVATARS=avatars

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

### Step 5: Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

### Step 6: Deploy to Vercel

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Import to Vercel**:
   - Go to [vercel.com](https://vercel.com) → **New Project**
   - Import your GitHub repo
   - Add all environment variables from `.env.local`
   - Change `NEXT_PUBLIC_APP_URL` to your Vercel URL
   - Click **Deploy**

3. **Update Supabase redirect URLs**:
   - Add `https://your-app.vercel.app/api/auth/callback` to Supabase Auth redirect URLs

4. **Update Azure CORS**:
   - Add your Vercel URL to Azure CORS allowed origins

---

## How Watch Together Works

The synchronized watching feature uses **Supabase Realtime Broadcast**:

1. **Host creates a room** → generates a unique room ID
2. **Host shares the link** → partner opens the same room
3. **Supabase Realtime Channel** is created for the room
4. **Playback events** (play, pause, seek) are broadcast to all participants
5. When the host pauses → all viewers pause at the same timestamp
6. When anyone seeks → all viewers jump to the same position
7. **Chat messages** are broadcast on the same channel (ephemeral, not stored in DB)
8. **Presence** tracking shows who's in the room

---

## Database Schema Overview

```
profiles         ← extends auth.users (name, avatar)
movies           ← metadata (title, blob references, uploaded_by)
postcards        ← floating photos (max 5 per user)
watch_rooms      ← sync rooms (host, movie, active status)
watch_room_participants ← who's in the room
watch_history    ← what was watched, with whom, progress
```

All tables have Row Level Security (RLS) policies:
- Profiles: readable by all, editable by owner
- Movies: readable by all, editable/deletable by uploader
- Postcards: readable by all, max 5 per user enforced by trigger
- Watch rooms: readable by all, manageable by host
- Watch history: private per user

---

## Customization Ideas

- Change the color theme in `tailwind.config.ts` (look for `cinema` colors)
- Change fonts in `globals.css` (Google Fonts import)
- Adjust postcard float behavior in `globals.css` (@keyframes postcardFloat)
- Modify max postcards limit in the `check_postcard_limit` database function

---

## Cost Estimates

For 2 users with occasional movie watching:

| Service | Free Tier | Expected Cost |
|---------|-----------|---------------|
| Supabase | 500MB DB, 2GB bandwidth | $0/month |
| Azure Blob | 5GB free, then ~$0.02/GB | ~$0.50-2/month for a few movies |
| Vercel | Free for personal use | $0/month |

**Total: $0-2/month** for normal usage.

---

Built with 💕 for movie nights together.
# cinema-for-two
