import {
  HomeInventory, RepairHistory, MaintenanceScheduler, ContractorDirectory,
  ApplianceRegistry, ExpenseTracker, HomeInsights,
  getSeedData,
  type InventoryItem, type RepairRecord, type MaintenanceTask,
  type Contractor, type Appliance, type ExpenseRecord
} from './home/tracker';

export interface Env {
  DEEPSEEK_API_KEY: string;
}

// ── State Management ──

async function loadData(env: Env) {
  const seed = getSeedData();
  // In production, load from KV. For demo, use seed data.
  // The in-memory state allows POST mutations during a session.
  return seed;
}

// Singleton state per isolate
let cachedData: ReturnType<typeof getSeedData> | null = null;
function getData(): ReturnType<typeof getSeedData> {
  if (!cachedData) cachedData = getSeedData();
  return cachedData;
}

function getTrackers(data: ReturnType<typeof getSeedData>) {
  const inventory = new HomeInventory(data.inventory);
  const repairs = new RepairHistory(data.repairs);
  const maintenance = new MaintenanceScheduler(data.maintenance);
  const contractors = new ContractorDirectory(data.contractors);
  const appliances = new ApplianceRegistry(data.appliances);
  const expenses = new ExpenseTracker(data.expenses);
  const insights = new HomeInsights(inventory, repairs, maintenance, contractors, appliances, expenses);
  return { inventory, repairs, maintenance, contractors, appliances, expenses, insights };
}

// ── Helpers ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ── Chat Handler ──

async function handleChat(request: Request, env: Env, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const { message } = await request.json() as { message: string };
  if (!message) return errorResponse('Message is required');

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // Fallback: generate a helpful local response
    return jsonResponse({
      reply: generateLocalResponse(message, data),
      source: 'local'
    });
  }

  const systemPrompt = buildSystemPrompt(data);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message }
            ],
            stream: true
          })
        });

        if (!response.ok) {
          const err = await response.text();
          controller.enqueue(`data: ${JSON.stringify({ error: 'DeepSeek API error', details: err })}\n\n`);
          controller.close();
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch {}
            }
          }
        }
        controller.enqueue('data: [DONE]\n\n');
        controller.close();
      } catch (err: any) {
        controller.enqueue(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function buildSystemPrompt(data: ReturnType<typeof getSeedData>): string {
  const contractors = data.contractors.map(c =>
    `- ${c.name} (${c.company}): ${c.specialty}, Rating: ${c.rating}/5, Phone: ${c.phone}`
  ).join('\n');

  const recentRepairs = data.repairs.slice(-5).map(r =>
    `- ${r.date}: ${r.itemOrArea} — ${r.issue} (Fixed by ${r.contractorName}, $${r.cost})`
  ).join('\n');

  const appliances = data.appliances.map(a =>
    `- ${a.name}: ${a.make} ${a.model} (Purchased ${a.purchaseDate}, Warranty until ${a.warrantyExpiry})`
  ).join('\n');

  const pendingMaintenance = data.maintenance.filter(m => m.overdue).map(m =>
    `- OVERDUE: ${m.task} (was due ${m.nextDue})`
  ).join('\n');

  return `You are HomeLog, a house brain that has lived in this home for years. You remember every repair, every contractor, every warranty date. Reference the home's specific history in every response.

This is a 3-bedroom home in Austin, TX. Roof installed 2019.HVAC: Lennox system installed 2021. Water heater: Rheem, replaced 2023.

CONTRACTORS:
${contractors}

RECENT REPAIRS:
${recentRepairs}

APPLIANCES:
${appliances}

PENDING MAINTENANCE:
${pendingMaintenance}

Be conversational but practical. Use specific details from this home's history. If they ask about a repair, reference past similar issues. If they ask about a contractor, give the specific one who worked on their house. Give actionable advice. You're like a super-knowledgeable handyman who has worked on this house for 20 years.`;
}

function generateLocalResponse(message: string, data: ReturnType<typeof getSeedData>): string {
  const msg = message.toLowerCase();
  const trackers = getTrackers(data);

  if (msg.includes('warranty') || msg.includes('warranties')) {
    const expiring = trackers.appliances.getExpiringWarranties(180);
    if (expiring.length > 0) {
      return `Here are the warranties expiring in the next 6 months:\n\n${expiring.map(a =>
        `- **${a.name}** (${a.make} ${a.model}): expires ${a.warrantyExpiry}`
      ).join('\n')}\n\nI'd recommend scheduling any needed service calls before these expire. The Samsung fridge warranty expires soonest — we already had the ice maker fixed under warranty in January 2025.`;
    }
    return "All warranties are currently in good shape! The longest remaining coverage is on the water softener (through 2032) and the HVAC system (through 2031).";
  }

  if (msg.includes('contractor') || msg.includes('plumber') || msg.includes('electrician') || msg.includes('hvac')) {
    const all = trackers.contractors.getAll();
    return `Here are the contractors who have worked on your house:\n\n${all.map(c =>
      `**${c.name}** — ${c.company}\nSpecialty: ${c.specialty}\nRating: ${c.rating}/5 | Phone: ${c.phone}\nLast used: ${c.lastUsed}\n${c.notes}`
    ).join('\n\n')}\n\nMike Rodriguez is my go-to for HVAC work — he's been out to the house multiple times and knows our Lennox system well.`;
  }

  if (msg.includes('repair') || msg.includes('broke') || msg.includes('fixed')) {
    const repairs = trackers.repairs.getAll();
    return `Here's your repair history:\n\n${repairs.map(r =>
      `**${r.date}**: ${r.itemOrArea}\nIssue: ${r.issue}\nFixed by: ${r.contractorName} | Cost: $${r.cost}${r.warrantyCovered ? ' (Warranty covered)' : ''}\nResolution: ${r.resolution}`
    ).join('\n\n')}\n\nTotal repair costs: $${trackers.repairs.getTotalCost()}. The biggest job was the panel upgrade — but that was more of an improvement that added value.`;
  }

  if (msg.includes('maintenance') || msg.includes('overdue') || msg.includes('todo')) {
    const overdue = trackers.maintenance.getOverdue();
    const upcoming = trackers.maintenance.getUpcoming(30);
    let reply = '';
    if (overdue.length > 0) {
      reply += `⚠️ **Overdue Maintenance:**\n${overdue.map(m => `- ${m.task} (was due ${m.nextDue})`).join('\n')}\n\n`;
    }
    if (upcoming.length > 0) {
      reply += `**Coming up in the next 30 days:**\n${upcoming.map(m => `- ${m.task} (due ${m.nextDue})`).join('\n')}\n\n`;
    }
    reply += `The HVAC filter is overdue — easy DIY, just grab a MERV 11 filter (20x25x1) and swap it in. Takes 2 minutes.`;
    return reply;
  }

  if (msg.includes('spend') || msg.includes('cost') || msg.includes('expense') || msg.includes('money')) {
    const totals = trackers.expenses.getCategoryTotals(2025);
    return `Here's your 2025 home spending breakdown:\n\n${Object.entries(totals).map(([cat, amt]) =>
      `- **${cat}**: $${amt}`
    ).join('\n')}\n\nTotal: $${Object.values(totals).reduce((a, b) => a + b, 0)}\n\nThe electric bill peaks in summer (July was $385) because of AC usage. The panel upgrade in November was the biggest single expense at $2,200, but that's a long-term investment.`;
  }

  if (msg.includes('roof')) {
    return "Your roof was installed in April 2019 — GAF Timberline HDZ architectural shingles with a 30-year warranty (expires 2049). It's in good shape. The yearly inspection is overdue though (was due March 20). I'd get up there or have someone check it, especially after any big storms. Austin Roofing Co did the original install.";
  }

  if (msg.includes('ac') || msg.includes('hvac') || msg.includes('air conditioning') || msg.includes('heating')) {
    return "Your Lennox HVAC system was installed in April 2021, so it's about 5 years old. Warranty runs through 2031.\n\nWe had an issue in July 2024 where the compressor was cycling — Mike Rodriguez came out and replaced the dual run capacitor and contactor relay for $485. It's been running great since.\n\nThe annual tune-up with Mike is coming up on April 10 — he checks refrigerant levels, coils, and electrical connections. Usually runs about $150. The filter is overdue for replacement though (MERV 11, 20x25x1).";
  }

  return `I'm HomeLog, your house brain. I know this home inside and out — every repair, every appliance, every contractor who's been here. Ask me about:\n\n- **Warranties** — what's expiring, what's covered\n- **Repairs** — what broke, who fixed it, how much it cost\n- **Maintenance** — what's overdue, what's coming up\n- **Contractors** — who to call for what\n- **Appliances** — makes, models, serial numbers\n- **Expenses** — where the money goes\n- **Specific systems** — HVAC, roof, plumbing, electrical\n\nWhat would you like to know about your home?`;
}

// ── Route Handlers ──

async function handleInventory(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const inventory = new HomeInventory(data.inventory);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    return jsonResponse(room ? inventory.getByRoom(room) : inventory.getAll());
  }
  const body = await request.json() as Omit<InventoryItem, 'id'>;
  const item = inventory.add(body);
  data.inventory.push(item);
  return jsonResponse(item, 201);
}

async function handleRepairs(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const repairs = new RepairHistory(data.repairs);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const item = url.searchParams.get('item');
    return jsonResponse(item ? repairs.getByItem(item) : repairs.getAll());
  }
  const body = await request.json() as Omit<RepairRecord, 'id'>;
  const repair = repairs.add(body);
  data.repairs.push(repair);
  return jsonResponse(repair, 201);
}

async function handleMaintenance(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const maintenance = new MaintenanceScheduler(data.maintenance);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter');
    if (filter === 'overdue') return jsonResponse(maintenance.getOverdue());
    if (filter === 'upcoming') return jsonResponse(maintenance.getUpcoming(30));
    return jsonResponse(maintenance.getAll());
  }
  const body = await request.json() as { action?: string; id?: string } & Omit<MaintenanceTask, 'id'>;
  if (body.action === 'complete' && body.id) {
    const idx = data.maintenance.findIndex(m => m.id === body.id);
    if (idx === -1) return errorResponse('Task not found', 404);
    const task = maintenance.complete(body.id)!;
    data.maintenance[idx] = task;
    return jsonResponse(task);
  }
  const newBody = { ...body, id: undefined } as any;
  delete newBody.action;
  const task = maintenance.add(newBody);
  data.maintenance.push(task);
  return jsonResponse(task, 201);
}

async function handleContractors(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const contractors = new ContractorDirectory(data.contractors);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const specialty = url.searchParams.get('specialty');
    return jsonResponse(specialty ? contractors.getBySpecialty(specialty) : contractors.getAll());
  }
  const body = await request.json() as Omit<Contractor, 'id'>;
  const contractor = contractors.add(body);
  data.contractors.push(contractor);
  return jsonResponse(contractor, 201);
}

async function handleAppliances(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const appliances = new ApplianceRegistry(data.appliances);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    return jsonResponse(room ? appliances.getByRoom(room) : appliances.getAll());
  }
  const body = await request.json() as Omit<Appliance, 'id'>;
  const appliance = appliances.add(body);
  data.appliances.push(appliance);
  return jsonResponse(appliance, 201);
}

async function handleExpenses(request: Request, data: ReturnType<typeof getSeedData>): Promise<Response> {
  const expenses = new ExpenseTracker(data.expenses);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    return jsonResponse(category ? expenses.getByCategory(category) : expenses.getAll());
  }
  const body = await request.json() as Omit<ExpenseRecord, 'id'>;
  const expense = expenses.add(body);
  data.expenses.push(expense);
  return jsonResponse(expense, 201);
}

async function handleWarnings(data: ReturnType<typeof getSeedData>): Promise<Response> {
  const trackers = getTrackers(data);
  return jsonResponse(trackers.insights.getWarnings());
}

// ── Main Worker ──


function getLandingHTML(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>home-ai</title><meta http-equiv="refresh" content="0;url=/app"><style>body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style><body><p>Redirecting...</p></body></html>`;
}

function getAppHTML(): string {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>HomeLog — Your House Brain</title>\n<style>\n  :root {\n    --bg: #F5F0EB;\n    --bg-card: #FFFFFF;\n    --bg-dark: #1a1a1a;\n    --fg: #2D2A26;\n    --fg-muted: #6B6560;\n    --fg-light: #9C9590;\n    --accent: #166534;\n    --accent-light: #DCFCE7;\n    --accent-hover: #14532D;\n    --warning: #D97706;\n    --warning-light: #FEF3C7;\n    --danger: #DC2626;\n    --danger-light: #FEE2E2;\n    --info: #2563EB;\n    --info-light: #DBEAFE;\n    --border: #E5E0DB;\n    --border-light: #EDEBE8;\n    --radius: 10px;\n    --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);\n    --shadow-lg: 0 4px 12px rgba(0,0,0,0.1);\n  }\n\n  * { margin: 0; padding: 0; box-sizing: border-box; }\n  body { font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; }\n\n  /* Layout */\n  .app { display: flex; height: 100vh; overflow: hidden; }\n  .sidebar { width: 220px; background: var(--bg-dark); color: #fff; display: flex; flex-direction: column; flex-shrink: 0; }\n  .sidebar-brand { padding: 20px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); }\n  .sidebar-brand h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }\n  .sidebar-brand p { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 2px; }\n  .sidebar-nav { padding: 8px; flex: 1; }\n  .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 13.5px; font-weight: 500; color: rgba(255,255,255,0.6); transition: all 0.15s; border: none; background: none; width: 100%; text-align: left; }\n  .nav-item:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }\n  .nav-item.active { background: var(--accent); color: #fff; }\n  .nav-icon { font-size: 16px; width: 20px; text-align: center; }\n  .nav-badge { margin-left: auto; background: var(--danger); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; }\n\n  .main { flex: 1; overflow-y: auto; }\n  .main-header { padding: 24px 32px 0; }\n  .main-header h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }\n  .main-header p { color: var(--fg-muted); font-size: 13.5px; margin-top: 2px; }\n  .main-content { padding: 20px 32px 32px; }\n\n  /* Cards */\n  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); }\n  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }\n  .card-header h3 { font-size: 14px; font-weight: 600; }\n\n  /* Dashboard Grid */\n  .dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }\n  .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); }\n  .stat-card .stat-label { font-size: 12px; color: var(--fg-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }\n  .stat-card .stat-value { font-size: 28px; font-weight: 700; margin-top: 4px; letter-spacing: -1px; }\n  .stat-card .stat-sub { font-size: 12px; color: var(--fg-light); margin-top: 4px; }\n  .stat-card.accent { border-left: 3px solid var(--accent); }\n  .stat-card.warning { border-left: 3px solid var(--warning); }\n  .stat-card.danger { border-left: 3px solid var(--danger); }\n  .stat-card.info { border-left: 3px solid var(--info); }\n\n  .dash-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }\n\n  /* Tables */\n  .table-wrap { overflow-x: auto; }\n  table { width: 100%; border-collapse: collapse; font-size: 13px; }\n  th { text-align: left; padding: 8px 12px; font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-muted); border-bottom: 2px solid var(--border); }\n  td { padding: 10px 12px; border-bottom: 1px solid var(--border-light); vertical-align: top; }\n  tr:hover td { background: var(--bg); }\n\n  /* Badges */\n  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }\n  .badge-green { background: var(--accent-light); color: var(--accent); }\n  .badge-yellow { background: var(--warning-light); color: var(--warning); }\n  .badge-red { background: var(--danger-light); color: var(--danger); }\n  .badge-blue { background: var(--info-light); color: var(--info); }\n\n  /* Warnings */\n  .warning-list { display: flex; flex-direction: column; gap: 8px; }\n  .warning-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 8px; font-size: 13px; }\n  .warning-item.critical { background: var(--danger-light); }\n  .warning-item.warn { background: var(--warning-light); }\n  .warning-item.info { background: var(--info-light); }\n  .warning-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }\n  .warning-text strong { display: block; margin-bottom: 2px; }\n\n  /* Chat */\n  .chat-container { display: flex; flex-direction: column; height: calc(100vh - 80px); }\n  .chat-messages { flex: 1; overflow-y: auto; padding: 16px 0; }\n  .chat-msg { display: flex; gap: 12px; margin-bottom: 16px; }\n  .chat-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }\n  .chat-avatar.bot { background: var(--accent-light); }\n  .chat-avatar.user { background: var(--info-light); }\n  .chat-bubble { max-width: 75%; padding: 12px 16px; border-radius: 12px; font-size: 13.5px; line-height: 1.6; }\n  .chat-bubble.bot { background: var(--bg-card); border: 1px solid var(--border); }\n  .chat-bubble.user { background: var(--accent); color: #fff; }\n  .chat-bubble strong { font-weight: 600; }\n  .chat-input-area { display: flex; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border); }\n  .chat-input { flex: 1; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; font-size: 14px; font-family: inherit; background: var(--bg-card); outline: none; transition: border-color 0.15s; }\n  .chat-input:focus { border-color: var(--accent); }\n  .chat-send { padding: 12px 20px; background: var(--accent); color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s; }\n  .chat-send:hover { background: var(--accent-hover); }\n  .chat-send:disabled { opacity: 0.5; cursor: not-allowed; }\n\n  /* Buttons */\n  .btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }\n  .btn-primary { background: var(--accent); color: #fff; }\n  .btn-primary:hover { background: var(--accent-hover); }\n  .btn-sm { padding: 5px 10px; font-size: 12px; }\n  .btn-outline { background: none; border: 1px solid var(--border); color: var(--fg); }\n  .btn-outline:hover { background: var(--bg); }\n\n  /* Modal */\n  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }\n  .modal { background: var(--bg-card); border-radius: 12px; padding: 24px; width: 480px; max-height: 80vh; overflow-y: auto; box-shadow: var(--shadow-lg); }\n  .modal h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; }\n  .form-group { margin-bottom: 14px; }\n  .form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--fg-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px; }\n  .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-family: inherit; background: var(--bg); outline: none; }\n  .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--accent); }\n  .form-group textarea { resize: vertical; min-height: 60px; }\n  .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }\n\n  /* Responsive */\n  @media (max-width: 768px) {\n    .sidebar { width: 60px; }\n    .sidebar-brand p, .nav-item span:not(.nav-icon) { display: none; }\n    .dash-stats { grid-template-columns: repeat(2, 1fr); }\n    .dash-grid { grid-template-columns: 1fr; }\n    .main-header, .main-content { padding-left: 16px; padding-right: 16px; }\n  }\n</style>\n</head>\n<body>\n<div class="app">\n  <!-- Sidebar -->\n  <nav class="sidebar">\n    <div class="sidebar-brand">\n      <h1>HomeLog</h1>\n      <p>Your House Brain</p>\n    </div>\n    <div class="sidebar-nav">\n      <button class="nav-item active" data-tab="dashboard"><span class="nav-icon">&#9751;</span><span>Dashboard</span></button>\n      <button class="nav-item" data-tab="inventory"><span class="nav-icon">&#9744;</span><span>Inventory</span></button>\n      <button class="nav-item" data-tab="repairs"><span class="nav-icon">&#9874;</span><span>Repairs</span></button>\n      <button class="nav-item" data-tab="maintenance"><span class="nav-icon">&#9200;</span><span>Maintenance</span><span class="nav-badge" id="maintBadge"></span></button>\n      <button class="nav-item" data-tab="contractors"><span class="nav-icon">&#9742;</span><span>Contractors</span></button>\n      <button class="nav-item" data-tab="appliances"><span class="nav-icon">&#9881;</span><span>Appliances</span></button>\n      <button class="nav-item" data-tab="expenses"><span class="nav-icon">&#36;</span><span>Expenses</span></button>\n      <button class="nav-item" data-tab="chat"><span class="nav-icon">&#9993;</span><span>Chat</span></button>\n    </div>\n  </nav>\n\n  <!-- Main Content -->\n  <main class="main" id="mainContent">\n    <!-- Populated by JS -->\n  </main>\n</div>\n\n<!-- Modal Container -->\n<div id="modalContainer"></div>\n\n<script>\nconst API = \'\';\nlet state = { inventory: [], repairs: [], maintenance: [], contractors: [], appliances: [], expenses: [], warnings: [] };\n\n// ── API ──\nasync function api(path, method = \'GET\', body = null) {\n  const opts = { method, headers: { \'Content-Type\': \'application/json\' } };\n  if (body) opts.body = JSON.stringify(body);\n  const res = await fetch(`${API}${path}`, opts);\n  return res.json();\n}\n\n// ── Navigation ──\nconst navItems = document.querySelectorAll(\'.nav-item\');\nnavItems.forEach(item => {\n  item.addEventListener(\'click\', () => {\n    navItems.forEach(n => n.classList.remove(\'active\'));\n    item.classList.add(\'active\');\n    renderTab(item.dataset.tab);\n  });\n});\n\nfunction renderTab(tab) {\n  const main = document.getElementById(\'mainContent\');\n  switch (tab) {\n    case \'dashboard\': renderDashboard(main); break;\n    case \'inventory\': renderTable(main, \'inventory\', state.inventory, inventoryCols); break;\n    case \'repairs\': renderTable(main, \'repairs\', state.repairs, repairCols); break;\n    case \'maintenance\': renderMaintenance(main); break;\n    case \'contractors\': renderTable(main, \'contractors\', state.contractors, contractorCols); break;\n    case \'appliances\': renderTable(main, \'appliances\', state.appliances, applianceCols); break;\n    case \'expenses\': renderExpenses(main); break;\n    case \'chat\': renderChat(main); break;\n  }\n}\n\n// ── Dashboard ──\nfunction renderDashboard(el) {\n  const overdue = state.maintenance.filter(m => m.overdue).length;\n  const expiringWarranties = state.appliances.filter(a => {\n    const days = daysUntil(a.warrantyExpiry);\n    return days >= 0 && days <= 90;\n  }).length;\n  const thisMonth = new Date().getMonth();\n  const thisYear = new Date().getFullYear();\n  const monthlySpend = state.expenses.filter(e => {\n    const d = new Date(e.date);\n    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;\n  }).reduce((s, e) => s + e.amount, 0);\n  const criticalWarnings = state.warnings.filter(w => w.severity === \'critical\').length;\n\n  el.innerHTML = `\n    <div class="main-header"><h2>Dashboard</h2><p>Your home at a glance — ${new Date().toLocaleDateString(\'en-US\', { month: \'long\', day: \'numeric\', year: \'numeric\' })}</p></div>\n    <div class="main-content">\n      <div class="dash-stats">\n        <div class="stat-card danger">\n          <div class="stat-label">Overdue Maintenance</div>\n          <div class="stat-value">${overdue}</div>\n          <div class="stat-sub">${overdue > 0 ? \'Needs attention\' : \'All caught up!\'}</div>\n        </div>\n        <div class="stat-card warning">\n          <div class="stat-label">Expiring Warranties</div>\n          <div class="stat-value">${expiringWarranties}</div>\n          <div class="stat-sub">Within 90 days</div>\n        </div>\n        <div class="stat-card info">\n          <div class="stat-label">This Month\'s Spending</div>\n          <div class="stat-value">$${monthlySpend.toLocaleString()}</div>\n          <div class="stat-sub">All home categories</div>\n        </div>\n        <div class="stat-card accent">\n          <div class="stat-label">Total Appliances</div>\n          <div class="stat-value">${state.appliances.length}</div>\n          <div class="stat-sub">${state.appliances.filter(a => new Date(a.warrantyExpiry) > new Date()).length} under warranty</div>\n        </div>\n      </div>\n\n      <div class="dash-grid">\n        <div class="card">\n          <div class="card-header"><h3>Recent Repairs</h3></div>\n          <div class="table-wrap"><table>\n            <thead><tr><th>Date</th><th>Item</th><th>Issue</th><th>Contractor</th><th>Cost</th></tr></thead>\n            <tbody>${state.repairs.slice(-5).reverse().map(r => `<tr>\n              <td>${r.date}</td><td>${r.itemOrArea}</td><td style="max-width:250px">${r.issue}</td>\n              <td>${r.contractorName}</td><td><strong>$${r.cost.toLocaleString()}</strong></td>\n            </tr>`).join(\'\')}</tbody>\n          </table></div>\n        </div>\n\n        <div style="display:flex;flex-direction:column;gap:16px">\n          <div class="card">\n            <div class="card-header"><h3>Warnings (${state.warnings.length})</h3></div>\n            <div class="warning-list">${state.warnings.slice(0, 5).map(w => `\n              <div class="warning-item ${w.severity === \'critical\' ? \'critical\' : w.severity === \'warning\' ? \'warn\' : \'info\'}">\n                <span class="warning-icon">${w.severity === \'critical\' ? \'&#9888;\' : w.severity === \'warning\' ? \'&#9888;\' : \'&#8505;\'}</span>\n                <div class="warning-text"><strong>${w.title}</strong>${w.message.substring(0, 100)}...</div>\n              </div>\n            `).join(\'\')}</div>\n          </div>\n\n          <div class="card">\n            <div class="card-header"><h3>Quick Actions</h3></div>\n            <div style="display:flex;flex-direction:column;gap:6px">\n              <button class="btn btn-primary" onclick="navItems[7].click()" style="text-align:left">Ask HomeLog a question</button>\n              <button class="btn btn-outline" onclick="navItems[3].click()">View maintenance calendar</button>\n              <button class="btn btn-outline" onclick="navItems[5].click()">Check appliance warranties</button>\n            </div>\n          </div>\n        </div>\n      </div>\n    </div>`;\n}\n\n// ── Maintenance ──\nfunction renderMaintenance(el) {\n  const overdue = state.maintenance.filter(m => m.overdue);\n  const upcoming = state.maintenance.filter(m => !m.overdue);\n  el.innerHTML = `\n    <div class="main-header"><h2>Maintenance Calendar</h2><p>${overdue.length} overdue, ${upcoming.length} scheduled</p></div>\n    <div class="main-content">\n      ${overdue.length > 0 ? `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--danger)">\n        <div class="card-header"><h3 style="color:var(--danger)">Overdue (${overdue.length})</h3></div>\n        <div class="table-wrap"><table>\n          <thead><tr><th>Task</th><th>Due</th><th>Recurrence</th><th>Est. Cost</th><th>Action</th></tr></thead>\n          <tbody>${overdue.map(m => `<tr style="background:var(--danger-light)">\n            <td><strong>${m.task}</strong><br><span style="color:var(--fg-muted);font-size:11px">${m.notes}</span></td>\n            <td><span class="badge badge-red">${m.nextDue}</span></td>\n            <td>${m.recurrence}</td>\n            <td>$${m.estimatedCost}</td>\n            <td><button class="btn btn-primary btn-sm" onclick="completeTask(\'${m.id}\')">Done</button></td>\n          </tr>`).join(\'\')}</tbody>\n        </table></div>\n      </div>` : \'\'}\n      <div class="card">\n        <div class="card-header"><h3>Scheduled</h3></div>\n        <div class="table-wrap"><table>\n          <thead><tr><th>Task</th><th>Next Due</th><th>Recurrence</th><th>Category</th><th>Est. Cost</th><th>Action</th></tr></thead>\n          <tbody>${upcoming.map(m => `<tr>\n            <td><strong>${m.task}</strong><br><span style="color:var(--fg-muted);font-size:11px">${m.notes}</span></td>\n            <td>${m.nextDue}</td>\n            <td><span class="badge badge-blue">${m.recurrence}</span></td>\n            <td>${m.category}</td>\n            <td>$${m.estimatedCost}</td>\n            <td><button class="btn btn-outline btn-sm" onclick="completeTask(\'${m.id}\')">Done</button></td>\n          </tr>`).join(\'\')}</tbody>\n        </table></div>\n      </div>\n    </div>`;\n}\n\nasync function completeTask(id) {\n  await api(\'/api/maintenance\', \'POST\', { action: \'complete\', id });\n  await loadAll();\n  renderTab(\'maintenance\');\n}\n\n// ── Expenses ──\nfunction renderExpenses(el) {\n  const byCategory = {};\n  state.expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });\n  const total = state.expenses.reduce((s, e) => s + e.amount, 0);\n  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);\n\n  el.innerHTML = `\n    <div class="main-header"><h2>Expenses</h2><p>Total tracked: $${total.toLocaleString()}</p></div>\n    <div class="main-content">\n      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">\n        ${sorted.map(([cat, amt]) => `<div class="stat-card" style="flex:1;min-width:140px">\n          <div class="stat-label">${cat}</div>\n          <div class="stat-value" style="font-size:20px">$${amt.toLocaleString()}</div>\n        </div>`).join(\'\')}\n      </div>\n      <div class="card">\n        <div class="card-header"><h3>All Expenses</h3><button class="btn btn-primary btn-sm" onclick="showExpenseModal()">+ Add Expense</button></div>\n        <div class="table-wrap"><table>\n          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>\n          <tbody>${state.expenses.sort((a, b) => b.date.localeCompare(a.date)).map(e => `<tr>\n            <td>${e.date}</td>\n            <td><span class="badge badge-${e.category === \'repair\' ? \'red\' : e.category === \'maintenance\' ? \'yellow\' : e.category === \'improvement\' ? \'green\' : \'blue\'}">${e.category}</span></td>\n            <td>${e.description}</td>\n            <td><strong>$${e.amount.toLocaleString()}</strong></td>\n          </tr>`).join(\'\')}</tbody>\n        </table></div>\n      </div>\n    </div>`;\n}\n\nfunction showExpenseModal() {\n  const cats = [\'maintenance\', \'improvement\', \'repair\', \'utilities\', \'insurance\', \'other\'];\n  showModal(\'Add Expense\', `\n    <div class="form-group"><label>Date</label><input type="date" id="exp-date" value="${new Date().toISOString().split(\'T\')[0]}"></div>\n    <div class="form-group"><label>Category</label><select id="exp-cat">${cats.map(c => `<option value="${c}">${c}</option>`).join(\'\')}</select></div>\n    <div class="form-group"><label>Amount ($)</label><input type="number" id="exp-amount" step="0.01"></div>\n    <div class="form-group"><label>Description</label><textarea id="exp-desc"></textarea></div>\n  `, async () => {\n    await api(\'/api/expenses\', \'POST\', {\n      date: document.getElementById(\'exp-date\').value,\n      category: document.getElementById(\'exp-cat\').value,\n      amount: parseFloat(document.getElementById(\'exp-amount\').value),\n      description: document.getElementById(\'exp-desc\').value\n    });\n    await loadAll();\n    renderTab(\'expenses\');\n  });\n}\n\n// ── Generic Table ──\nconst inventoryCols = [\n  { key: \'room\', label: \'Room\' },\n  { key: \'itemName\', label: \'Item\' },\n  { key: \'category\', label: \'Category\' },\n  { key: \'purchaseDate\', label: \'Purchased\' },\n  { key: \'warrantyExpiry\', label: \'Warranty Until\' },\n  { key: \'replacementCost\', label: \'Replacement\', fmt: v => `$${v.toLocaleString()}` },\n];\nconst repairCols = [\n  { key: \'date\', label: \'Date\' },\n  { key: \'itemOrArea\', label: \'Item/Area\' },\n  { key: \'issue\', label: \'Issue\' },\n  { key: \'contractorName\', label: \'Contractor\' },\n  { key: \'cost\', label: \'Cost\', fmt: v => `$${v.toLocaleString()}` },\n  { key: \'warrantyCovered\', label: \'Warranty\', fmt: v => v ? \'<span class="badge badge-green">Yes</span>\' : \'<span class="badge badge-yellow">No</span>\' },\n];\nconst contractorCols = [\n  { key: \'name\', label: \'Name\' },\n  { key: \'company\', label: \'Company\' },\n  { key: \'specialty\', label: \'Specialty\' },\n  { key: \'phone\', label: \'Phone\' },\n  { key: \'rating\', label: \'Rating\', fmt: v => `${v}/5` },\n  { key: \'lastUsed\', label: \'Last Used\' },\n];\nconst applianceCols = [\n  { key: \'name\', label: \'Appliance\' },\n  { key: \'make\', label: \'Make\' },\n  { key: \'model\', label: \'Model\' },\n  { key: \'room\', label: \'Room\' },\n  { key: \'purchaseDate\', label: \'Purchased\' },\n  { key: \'warrantyExpiry\', label: \'Warranty Until\', fmt: (v, row) => {\n    const days = daysUntil(v);\n    if (days < 0) return `<span class="badge badge-red">Expired</span>`;\n    if (days <= 90) return `<span class="badge badge-yellow">${v}</span>`;\n    return `<span class="badge badge-green">${v}</span>`;\n  }},\n  { key: \'replacementCost\', label: \'Replacement\', fmt: v => `$${v.toLocaleString()}` },\n];\n\nfunction renderTable(el, type, data, cols) {\n  const titles = { inventory: \'Home Inventory\', repairs: \'Repair History\', contractors: \'Contractors\', appliances: \'Appliance Registry\' };\n  const descs = { inventory: `${data.length} items across all rooms`, repairs: `${data.length} repairs logged`, contractors: `${data.length} contractors on file`, appliances: `${data.length} appliances tracked` };\n\n  el.innerHTML = `\n    <div class="main-header"><h2>${titles[type]}</h2><p>${descs[type]}</p></div>\n    <div class="main-content">\n      <div class="card">\n        <div class="card-header"><h3>All ${titles[type]}</h3></div>\n        <div class="table-wrap"><table>\n          <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join(\'\')}</tr></thead>\n          <tbody>${data.map(row => `<tr>${cols.map(c => {\n            const val = row[c.key];\n            if (c.fmt) return `<td>${c.fmt(val, row)}</td>`;\n            if (c.key === \'issue\' || c.key === \'specialty\') return `<td style="max-width:250px">${val}</td>`;\n            return `<td>${val}</td>`;\n          }).join(\'\')}</tr>`).join(\'\')}</tbody>\n        </table></div>\n      </div>\n    </div>`;\n}\n\n// ── Chat ──\nlet chatHistory = [];\n\nfunction renderChat(el) {\n  el.innerHTML = `\n    <div class="main-header"><h2>Chat with HomeLog</h2><p>Your house brain — ask anything about your home</p></div>\n    <div class="main-content">\n      <div class="chat-container">\n        <div class="chat-messages" id="chatMessages">\n          ${chatHistory.length === 0 ? `<div class="chat-msg">\n            <div class="chat-avatar bot">&#9751;</div>\n            <div class="chat-bubble bot">\n              Hey! I\'m HomeLog — your house brain. I\'ve been tracking this home since 2019. I know every repair, every appliance serial number, every contractor who\'s been here. Try asking me about:<br><br>\n              <strong>"What warranties are expiring?"</strong><br>\n              <strong>"Who should I call for plumbing?"</strong><br>\n              <strong>"What maintenance is overdue?"</strong><br>\n              <strong>"How much have we spent on repairs?"</strong><br>\n              <strong>"Tell me about the HVAC system"</strong>\n            </div>\n          </div>` : chatHistory.map(m => `\n            <div class="chat-msg">\n              <div class="chat-avatar ${m.role}">${m.role === \'bot\' ? \'&#9751;\' : \'&#9786;\'}</div>\n              <div class="chat-bubble ${m.role}">${m.text}</div>\n            </div>\n          `).join(\'\')}\n        </div>\n        <div class="chat-input-area">\n          <input class="chat-input" id="chatInput" placeholder="Ask about your home..." autocomplete="off">\n          <button class="chat-send" id="chatSend" onclick="sendChat()">Send</button>\n        </div>\n      </div>\n    </div>`;\n\n  const input = document.getElementById(\'chatInput\');\n  input.addEventListener(\'keydown\', e => { if (e.key === \'Enter\') sendChat(); });\n  input.focus();\n  scrollChat();\n}\n\nfunction scrollChat() {\n  setTimeout(() => {\n    const el = document.getElementById(\'chatMessages\');\n    if (el) el.scrollTop = el.scrollHeight;\n  }, 50);\n}\n\nasync function sendChat() {\n  const input = document.getElementById(\'chatInput\');\n  const send = document.getElementById(\'chatSend\');\n  const msg = input.value.trim();\n  if (!msg) return;\n\n  chatHistory.push({ role: \'user\', text: msg });\n  input.value = \'\';\n  send.disabled = true;\n\n  // Show typing\n  chatHistory.push({ role: \'bot\', text: \'...\' });\n  renderChat(document.getElementById(\'mainContent\'));\n\n  try {\n    const res = await fetch(`${API}/api/chat`, {\n      method: \'POST\',\n      headers: { \'Content-Type\': \'application/json\' },\n      body: JSON.stringify({ message: msg })\n    });\n\n    // Remove typing indicator\n    chatHistory.pop();\n\n    if (res.headers.get(\'Content-Type\')?.includes(\'text/event-stream\')) {\n      // SSE streaming\n      chatHistory.push({ role: \'bot\', text: \'\' });\n      renderChat(document.getElementById(\'mainContent\'));\n      const reader = res.body.getReader();\n      const decoder = new TextDecoder();\n      let buffer = \'\';\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        buffer += decoder.decode(value, { stream: true });\n        const lines = buffer.split(\'\\n\');\n        buffer = lines.pop() || \'\';\n        for (const line of lines) {\n          if (line.startsWith(\'data: \') && line !== \'data: [DONE]\') {\n            try {\n              const json = JSON.parse(line.slice(6));\n              if (json.content) {\n                chatHistory[chatHistory.length - 1].text += json.content;\n                const bubbles = document.querySelectorAll(\'.chat-bubble.bot\');\n                if (bubbles.length) bubbles[bubbles.length - 1].innerHTML = formatChat(chatHistory[chatHistory.length - 1].text);\n                scrollChat();\n              }\n            } catch {}\n          }\n        }\n      }\n    } else {\n      // JSON response\n      const data = await res.json();\n      chatHistory.push({ role: \'bot\', text: data.reply || data.error || \'Something went wrong.\' });\n    }\n  } catch (err) {\n    chatHistory.pop();\n    chatHistory.push({ role: \'bot\', text: \'Connection error. Make sure the API server is running.\' });\n  }\n\n  send.disabled = false;\n  renderChat(document.getElementById(\'mainContent\'));\n}\n\nfunction formatChat(text) {\n  return text\n    .replace(/\\*\\*(.*?)\\*\\*/g, \'<strong>$1</strong>\')\n    .replace(/\\n/g, \'<br>\');\n}\n\n// ── Modal ──\nfunction showModal(title, bodyHtml, onSave) {\n  const container = document.getElementById(\'modalContainer\');\n  container.innerHTML = `\n    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">\n      <div class="modal">\n        <h3>${title}</h3>\n        ${bodyHtml}\n        <div class="form-actions">\n          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>\n          <button class="btn btn-primary" id="modalSave">Save</button>\n        </div>\n      </div>\n    </div>`;\n  document.getElementById(\'modalSave\').addEventListener(\'click\', async () => {\n    await onSave();\n    closeModal();\n  });\n}\nfunction closeModal() { document.getElementById(\'modalContainer\').innerHTML = \'\'; }\n\n// ── Utils ──\nfunction daysUntil(dateStr) {\n  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);\n}\n\n// ── Init ──\nasync function loadAll() {\n  const [inventory, repairs, maintenance, contractors, appliances, expenses, warnings] = await Promise.all([\n    api(\'/api/inventory\'), api(\'/api/repairs\'), api(\'/api/maintenance\'),\n    api(\'/api/contractors\'), api(\'/api/appliances\'), api(\'/api/expenses\'), api(\'/api/warnings\')\n  ]);\n  state = { inventory, repairs, maintenance, contractors, appliances, expenses, warnings };\n\n  const overdue = maintenance.filter(m => m.overdue).length;\n  const badge = document.getElementById(\'maintBadge\');\n  if (overdue > 0) { badge.textContent = overdue; badge.style.display = \'\'; }\n  else badge.style.display = \'none\';\n}\n\nloadAll().then(() => renderTab(\'dashboard\'));\n</script>\n</body>\n</html>\n';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const data = getData();

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // API Routes
    if (path === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env, data);
    }
    if (path === '/api/inventory' && (request.method === 'GET' || request.method === 'POST')) {
      return handleInventory(request, data);
    }
    if (path === '/api/repairs' && (request.method === 'GET' || request.method === 'POST')) {
      return handleRepairs(request, data);
    }
    if (path === '/api/maintenance' && (request.method === 'GET' || request.method === 'POST')) {
      return handleMaintenance(request, data);
    }
    if (path === '/api/contractors' && (request.method === 'GET' || request.method === 'POST')) {
      return handleContractors(request, data);
    }
    if (path === '/api/appliances' && (request.method === 'GET' || request.method === 'POST')) {
      return handleAppliances(request, data);
    }
    if (path === '/api/expenses' && (request.method === 'GET' || request.method === 'POST')) {
      return handleExpenses(request, data);
    }
    if (path === '/api/warnings' && request.method === 'GET') {
      return handleWarnings(data);
    }

    // Serve static HTML — redirect / to /app.html or serve assets
    if (path === '/' || path === '/index.html') {
      return new Response(getAppHTML(), { headers: { "Content-Type": "text/html" } });
    }

    return errorResponse('Not found', 404);
  }
};

