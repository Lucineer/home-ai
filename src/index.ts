import {
  HomeInventory, RepairHistory, MaintenanceScheduler, ContractorDirectory,
  ApplianceRegistry, ExpenseTracker, HomeInsights,
  getSeedData,
  type InventoryItem, type RepairRecord, type MaintenanceTask,
  type Contractor, type Appliance, type ExpenseRecord
} from './home/tracker';

export interface Env {
  DEEPSEEK_API_KEY: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
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
      return env.ASSETS.fetch(new Request(new URL('/app.html', url.origin).toString()));
    }

    return errorResponse('Not found', 404);
  }
};

