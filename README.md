# HomeLog — Your House Brain

A house brain that accumulates irreplaceable knowledge about your home over years. After 5 years of homeownership, this repo is invaluable.

Built on Cloudflare Workers + single HTML file. Zero dependencies at runtime.

## What It Does

HomeLog tracks everything about your home that you'll wish you remembered later:

- **Inventory** — Every room, every item, purchase dates, replacement costs
- **Repairs** — What broke, who fixed it, how much it cost, what parts were used
- **Maintenance** — Scheduled recurring tasks (HVAC filters, gutter cleaning, water heater flush)
- **Contractors** — Who to call, their specialty, rating, and history with your home
- **Appliances** — Make, model, serial number, warranty status, repair history
- **Expenses** — Track every dollar spent on the home by category
- **Warnings** — Proactive alerts for expiring warranties, overdue maintenance, seasonal reminders
- **Chat** — Talk to an AI that knows your home's entire history

## The Value Proposition

This is NOT a template. This is a real product. The value grows with time.

When your AC breaks at 2am, you don't Google "HVAC repair near me" — you open HomeLog and see that Mike Rodriguez fixed your Lennox XC25 in July 2024, replaced the capacitor and contactor, and his number is right there.

When a buyer asks "when was the roof replaced?", you have the date, contractor, warranty, and shingle brand.

When your realtor says "have you done any improvements?", you have a $2,200 panel upgrade documented with the electrician's name and parts list.

## API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Chat with HomeLog AI (SSE streaming to DeepSeek) |
| `/api/inventory` | GET, POST | Home inventory items |
| `/api/repairs` | GET, POST | Repair history |
| `/api/maintenance` | GET, POST | Scheduled maintenance |
| `/api/contractors` | GET, POST | Contractor directory |
| `/api/appliances` | GET, POST | Appliance registry |
| `/api/expenses` | GET, POST | Home expense tracking |
| `/api/warnings` | GET | Proactive warnings and alerts |

## Setup

```bash
npm install
npx wrangler dev
```

Open `http://localhost:8787` — comes pre-loaded with realistic seed data for a 3-bedroom Austin, TX home.

## Configuration

Set your DeepSeek API key for AI-powered chat:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

Without the API key, HomeLog uses a smart local response engine that understands queries about warranties, repairs, maintenance, contractors, expenses, and specific systems.

## Deploy

```bash
npx wrangler deploy
```

## Architecture

```
src/
  index.ts          — Cloudflare Worker (API routes + static serving)
  home/
    tracker.ts      — All data models, tracker classes, and seed data

public/
  app.html          — Complete SPA (dashboard, tables, chat)
```

## Seed Data

The demo includes a realistic Austin, TX home with:
- 15 appliances (Lennox HVAC, Samsung fridge, Bosch dishwasher, LG washer/dryer, etc.)
- 5 repair records (AC repair, sink plumbing, fridge ice maker, panel upgrade, sump pump)
- 3 contractors (HVAC, electrical, plumbing)
- 10 maintenance tasks (HVAC filter, gutter cleaning, water heater flush, etc.)
- 25 expense records across all categories
- 15 inventory items (roof, floors, fence, deck, EV charger, etc.)

## Tech Stack

- Cloudflare Workers (TypeScript)
- Vanilla HTML/CSS/JS (no framework, no build step for frontend)
- DeepSeek API for AI chat (optional, falls back to local engine)
- Wrangler for development and deployment
