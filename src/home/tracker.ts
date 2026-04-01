// HomeLog — House Brain Data Models & Trackers
// This module is the memory of your home. Every item, repair, contractor, and dollar spent.

export interface InventoryItem {
  id: string;
  room: string;
  itemName: string;
  category: string;
  purchaseDate: string;
  warrantyExpiry: string;
  replacementCost: number;
  notes: string;
}

export interface RepairRecord {
  id: string;
  date: string;
  itemOrArea: string;
  issue: string;
  contractorId: string;
  contractorName: string;
  cost: number;
  partsUsed: string[];
  resolution: string;
  warrantyCovered: boolean;
}

export interface MaintenanceTask {
  id: string;
  task: string;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'semi-annual' | 'yearly' | 'biennial';
  lastDone: string;
  nextDue: string;
  category: string;
  estimatedCost: number;
  notes: string;
  overdue: boolean;
}

export interface Contractor {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  specialty: string;
  rating: number;
  lastUsed: string;
  notes: string;
}

export interface Appliance {
  id: string;
  name: string;
  make: string;
  model: string;
  serial: string;
  room: string;
  purchaseDate: string;
  warrantyExpiry: string;
  warrantyProvider: string;
  manualUrl: string;
  replacementCost: number;
  repairIds: string[];
}

export interface ExpenseRecord {
  id: string;
  date: string;
  category: 'maintenance' | 'improvement' | 'repair' | 'utilities' | 'insurance' | 'other';
  amount: number;
  description: string;
  relatedItemId?: string;
  relatedRepairId?: string;
}

export interface Warning {
  type: 'warranty_expiring' | 'warranty_expired' | 'maintenance_overdue' | 'maintenance_upcoming' | 'seasonal_reminder' | 'appliance_age';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  relatedId?: string;
  dueDate?: string;
}

// ── In-memory store (KV-backed in production) ──

interface HomeData {
  inventory: InventoryItem[];
  repairs: RepairRecord[];
  maintenance: MaintenanceTask[];
  contractors: Contractor[];
  appliances: Appliance[];
  expenses: ExpenseRecord[];
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Tracker Classes ──

export class HomeInventory {
  private items: InventoryItem[];
  constructor(items: InventoryItem[]) { this.items = items; }
  getAll(): InventoryItem[] { return this.items; }
  getByRoom(room: string): InventoryItem[] { return this.items.filter(i => i.room.toLowerCase() === room.toLowerCase()); }
  getById(id: string): InventoryItem | undefined { return this.items.find(i => i.id === id); }
  add(item: Omit<InventoryItem, 'id'>): InventoryItem {
    const newItem = { ...item, id: generateId() };
    this.items.push(newItem);
    return newItem;
  }
  update(id: string, updates: Partial<InventoryItem>): InventoryItem | null {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    this.items[idx] = { ...this.items[idx], ...updates };
    return this.items[idx];
  }
  delete(id: string): boolean {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }
}

export class RepairHistory {
  private repairs: RepairRecord[];
  constructor(repairs: RepairRecord[]) { this.repairs = repairs; }
  getAll(): RepairRecord[] { return this.repairs; }
  getByItem(itemOrArea: string): RepairRecord[] {
    return this.repairs.filter(r => r.itemOrArea.toLowerCase().includes(itemOrArea.toLowerCase()));
  }
  getByContractor(contractorId: string): RepairRecord[] {
    return this.repairs.filter(r => r.contractorId === contractorId);
  }
  add(repair: Omit<RepairRecord, 'id'>): RepairRecord {
    const newRepair = { ...repair, id: generateId() };
    this.repairs.push(newRepair);
    return newRepair;
  }
  getTotalCost(): number { return this.repairs.reduce((sum, r) => sum + r.cost, 0); }
}

export class MaintenanceScheduler {
  private tasks: MaintenanceTask[];
  constructor(tasks: MaintenanceTask[]) { this.tasks = tasks; }
  getAll(): MaintenanceTask[] { return this.tasks; }
  getOverdue(): MaintenanceTask[] { return this.tasks.filter(t => t.overdue); }
  getUpcoming(days: number = 30): MaintenanceTask[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);
    return this.tasks.filter(t => {
      const due = new Date(t.nextDue);
      return due <= cutoff && !t.overdue;
    });
  }
  add(task: Omit<MaintenanceTask, 'id'>): MaintenanceTask {
    const newTask = { ...task, id: generateId() };
    this.tasks.push(newTask);
    return newTask;
  }
  complete(id: string): MaintenanceTask | null {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const task = this.tasks[idx];
    const lastDone = new Date();
    const nextDue = calculateNextDue(lastDone, task.recurrence);
    this.tasks[idx] = { ...task, lastDone: lastDone.toISOString().split('T')[0], nextDue: nextDue.toISOString().split('T')[0], overdue: false };
    return this.tasks[idx];
  }
}

export class ContractorDirectory {
  private contractors: Contractor[];
  constructor(contractors: Contractor[]) { this.contractors = contractors; }
  getAll(): Contractor[] { return this.contractors; }
  getBySpecialty(specialty: string): Contractor[] {
    return this.contractors.filter(c => c.specialty.toLowerCase().includes(specialty.toLowerCase()));
  }
  getById(id: string): Contractor | undefined { return this.contractors.find(c => c.id === id); }
  add(contractor: Omit<Contractor, 'id'>): Contractor {
    const newContractor = { ...contractor, id: generateId() };
    this.contractors.push(newContractor);
    return newContractor;
  }
  update(id: string, updates: Partial<Contractor>): Contractor | null {
    const idx = this.contractors.findIndex(c => c.id === id);
    if (idx === -1) return null;
    this.contractors[idx] = { ...this.contractors[idx], ...updates };
    return this.contractors[idx];
  }
}

export class ApplianceRegistry {
  private appliances: Appliance[];
  constructor(appliances: Appliance[]) { this.appliances = appliances; }
  getAll(): Appliance[] { return this.appliances; }
  getByRoom(room: string): Appliance[] { return this.appliances.filter(a => a.room.toLowerCase() === room.toLowerCase()); }
  getById(id: string): Appliance | undefined { return this.appliances.find(a => a.id === id); }
  add(appliance: Omit<Appliance, 'id'>): Appliance {
    const newApp = { ...appliance, id: generateId() };
    this.appliances.push(newApp);
    return newApp;
  }
  update(id: string, updates: Partial<Appliance>): Appliance | null {
    const idx = this.appliances.findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.appliances[idx] = { ...this.appliances[idx], ...updates };
    return this.appliances[idx];
  }
  getExpiringWarranties(days: number = 90): Appliance[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);
    return this.appliances.filter(a => {
      const expiry = new Date(a.warrantyExpiry);
      return expiry >= now && expiry <= cutoff;
    });
  }
}

export class ExpenseTracker {
  private expenses: ExpenseRecord[];
  constructor(expenses: ExpenseRecord[]) { this.expenses = expenses; }
  getAll(): ExpenseRecord[] { return this.expenses; }
  getByCategory(category: string): ExpenseRecord[] {
    return this.expenses.filter(e => e.category === category);
  }
  getByMonth(year: number, month: number): ExpenseRecord[] {
    return this.expenses.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }
  add(expense: Omit<ExpenseRecord, 'id'>): ExpenseRecord {
    const newExpense = { ...expense, id: generateId() };
    this.expenses.push(newExpense);
    return newExpense;
  }
  getMonthlyTotal(year: number, month: number): number {
    return this.getByMonth(year, month).reduce((sum, e) => sum + e.amount, 0);
  }
  getCategoryTotals(year?: number): Record<string, number> {
    const filtered = year ? this.expenses.filter(e => new Date(e.date).getFullYear() === year) : this.expenses;
    return filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {} as Record<string, number>);
  }
}

export class HomeInsights {
  constructor(
    private inventory: HomeInventory,
    private repairs: RepairHistory,
    private maintenance: MaintenanceScheduler,
    private contractors: ContractorDirectory,
    private appliances: ApplianceRegistry,
    private expenses: ExpenseTracker
  ) {}

  getWarnings(): Warning[] {
    const warnings: Warning[] = [];
    const now = new Date();

    // Warranty expiry warnings
    for (const app of this.appliances.getAll()) {
      const expiry = new Date(app.warrantyExpiry);
      const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);

      if (daysUntil < 0) {
        warnings.push({
          type: 'warranty_expired',
          severity: 'info',
          title: `${app.name} warranty expired`,
          message: `Your ${app.make} ${app.name} warranty expired on ${app.warrantyExpiry}. Any repairs will be out-of-pocket.`,
          relatedId: app.id,
          dueDate: app.warrantyExpiry
        });
      } else if (daysUntil <= 90) {
        warnings.push({
          type: 'warranty_expiring',
          severity: daysUntil <= 30 ? 'critical' : 'warning',
          title: `${app.name} warranty expiring`,
          message: `Your ${app.make} ${app.name} warranty expires in ${daysUntil} days (${app.warrantyExpiry}). Consider scheduling any needed repairs.`,
          relatedId: app.id,
          dueDate: app.warrantyExpiry
        });
      }
    }

    // Overdue maintenance
    for (const task of this.maintenance.getOverdue()) {
      warnings.push({
        type: 'maintenance_overdue',
        severity: 'critical',
        title: `Overdue: ${task.task}`,
        message: `"${task.task}" was due on ${task.nextDue}. This is a ${task.recurrence} task. ${task.notes}`,
        relatedId: task.id,
        dueDate: task.nextDue
      });
    }

    // Upcoming maintenance (next 30 days)
    for (const task of this.maintenance.getUpcoming(30)) {
      const due = new Date(task.nextDue);
      const daysUntil = Math.ceil((due.getTime() - now.getTime()) / 86400000);
      warnings.push({
        type: 'maintenance_upcoming',
        severity: 'info',
        title: `Upcoming: ${task.task}`,
        message: `"${task.task}" is due in ${daysUntil} days (${task.nextDue}).`,
        relatedId: task.id,
        dueDate: task.nextDue
      });
    }

    // Appliance age warnings (over 10 years)
    for (const app of this.appliances.getAll()) {
      const age = (now.getTime() - new Date(app.purchaseDate).getTime()) / (365.25 * 86400000);
      if (age > 10) {
        warnings.push({
          type: 'appliance_age',
          severity: 'warning',
          title: `Aging: ${app.name}`,
          message: `Your ${app.make} ${app.name} is ${Math.round(age)} years old (purchased ${app.purchaseDate}). Typical lifespan may be nearing end. Start budgeting ~$${app.replacementCost} for replacement.`,
          relatedId: app.id
        });
      }
    }

    // Seasonal reminders
    const month = now.getMonth();
    if (month >= 9 && month <= 11) {
      warnings.push({
        type: 'seasonal_reminder',
        severity: 'info',
        title: 'Fall Maintenance',
        message: 'Time to: clean gutters, check heating system, seal windows, test smoke/CO detectors, winterize outdoor faucets.'
      });
    } else if (month >= 2 && month <= 4) {
      warnings.push({
        type: 'seasonal_reminder',
        severity: 'info',
        title: 'Spring Maintenance',
        message: 'Time to: inspect roof for winter damage, service AC, clean window screens, check grading around foundation.'
      });
    } else if (month >= 5 && month <= 7) {
      warnings.push({
        type: 'seasonal_reminder',
        severity: 'info',
        title: 'Summer Maintenance',
        message: 'Time to: stain/paint exterior, check for pest damage, clean dryer vent, inspect deck/patio.'
      });
    }

    return warnings.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }
}

// ── Recurrence Calculator ──

function calculateNextDue(lastDone: Date, recurrence: MaintenanceTask['recurrence']): Date {
  const next = new Date(lastDone);
  switch (recurrence) {
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'semi-annual': next.setMonth(next.getMonth() + 6); break;
    case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
    case 'biennial': next.setFullYear(next.getFullYear() + 2); break;
  }
  return next;
}

// ── Seed Data — A Real Home ──

export const SEED_CONTRACTORS: Contractor[] = [
  {
    id: 'c1',
    name: 'Mike Rodriguez',
    company: 'Rodriguez HVAC Services',
    phone: '(512) 555-0142',
    email: 'mike@rodriguezhvac.com',
    specialty: 'HVAC installation & repair',
    rating: 4.9,
    lastUsed: '2025-08-15',
    notes: 'Excellent work. Always on time. Services all major brands. Has worked on our Lennox system multiple times.'
  },
  {
    id: 'c2',
    name: 'Sarah Chen',
    company: 'Chen Electric',
    phone: '(512) 555-0298',
    email: 'sarah@chenelectric.com',
    specialty: 'Electrical work & panel upgrades',
    rating: 4.7,
    lastUsed: '2024-11-03',
    notes: 'Licensed master electrician. Upgraded our panel from 100A to 200A. Fair pricing, clean work.'
  },
  {
    id: 'c3',
    name: 'James Wilson',
    company: 'Wilson Plumbing Co.',
    phone: '(512) 555-0377',
    email: 'info@wilsonplumbing.com',
    specialty: 'Plumbing & water heater',
    rating: 4.8,
    lastUsed: '2025-06-20',
    notes: 'Family business, 3rd generation. Replaced our water heater in 2024. Also fixed a slab leak in 2023.'
  }
];

export const SEED_APPLIANCES: Appliance[] = [
  {
    id: 'a1', name: 'Central AC Unit', make: 'Lennox', model: 'XC25-024', serial: 'LNX5812A001234',
    room: 'Exterior', purchaseDate: '2021-04-10', warrantyExpiry: '2031-04-10',
    warrantyProvider: 'Lennox Extended Warranty', manualUrl: 'https://www.lennox.com/manuals/xc25',
    replacementCost: 4500, repairIds: ['r1']
  },
  {
    id: 'a2', name: 'Gas Furnace', make: 'Lennox', model: 'SLP99V-070', serial: 'LNX5812B005678',
    room: 'Attic', purchaseDate: '2021-04-10', warrantyExpiry: '2031-04-10',
    warrantyProvider: 'Lennox Extended Warranty', manualUrl: 'https://www.lennox.com/manuals/slp99',
    replacementCost: 3800, repairIds: []
  },
  {
    id: 'a3', name: 'Water Heater', make: 'Rheem', model: 'MR50245', serial: 'RH1923A007890',
    room: 'Garage', purchaseDate: '2023-03-15', warrantyExpiry: '2033-03-15',
    warrantyProvider: 'Rheem 10-Year Warranty', manualUrl: 'https://www.rheem.com/manuals/mr50245',
    replacementCost: 1200, repairIds: []
  },
  {
    id: 'a4', name: 'Refrigerator', make: 'Samsung', model: 'RF28R7351SG', serial: 'SAM2020A123456',
    room: 'Kitchen', purchaseDate: '2020-08-20', warrantyExpiry: '2025-08-20',
    warrantyProvider: 'Samsung 5-Year Sealed System', manualUrl: 'https://www.samsung.com/support/rf28r7351sg',
    replacementCost: 2800, repairIds: ['r3']
  },
  {
    id: 'a5', name: 'Dishwasher', make: 'Bosch', model: 'SHXM78W55N', serial: 'BOS2021A987654',
    room: 'Kitchen', purchaseDate: '2021-01-05', warrantyExpiry: '2024-01-05',
    warrantyProvider: 'Bosch 3-Year Limited', manualUrl: 'https://www.bosch-home.com/manuals/shxm78w55n',
    replacementCost: 1100, repairIds: []
  },
  {
    id: 'a6', name: 'Washing Machine', make: 'LG', model: 'WM4000HWA', serial: 'LG2020A111222',
    room: 'Laundry Room', purchaseDate: '2020-03-12', warrantyExpiry: '2025-03-12',
    warrantyProvider: 'LG 5-Year Limited', manualUrl: 'https://www.lg.com/support/wm4000hwa',
    replacementCost: 1200, repairIds: []
  },
  {
    id: 'a7', name: 'Dryer', make: 'LG', model: 'DLEX4000W', serial: 'LG2020A333444',
    room: 'Laundry Room', purchaseDate: '2020-03-12', warrantyExpiry: '2025-03-12',
    warrantyProvider: 'LG 5-Year Limited', manualUrl: 'https://www.lg.com/support/dlex4000w',
    replacementCost: 1100, repairIds: []
  },
  {
    id: 'a8', name: 'Range/Oven', make: 'GE', model: 'JB735SPSS', serial: 'GE2019A555666',
    room: 'Kitchen', purchaseDate: '2019-06-01', warrantyExpiry: '2022-06-01',
    warrantyProvider: 'GE 3-Year Limited (Expired)', manualUrl: 'https://www.geappliances.com/support/jb735spss',
    replacementCost: 1500, repairIds: []
  },
  {
    id: 'a9', name: 'Microwave', make: 'Panasonic', model: 'NN-SN966S', serial: 'PAN2020A777888',
    room: 'Kitchen', purchaseDate: '2020-11-15', warrantyExpiry: '2022-11-15',
    warrantyProvider: 'Panasonic 2-Year (Expired)', manualUrl: 'https://www.panasonic.com/support/nn-sn966s',
    replacementCost: 350, repairIds: []
  },
  {
    id: 'a10', name: 'Garbage Disposal', make: 'InSinkErator', model: 'EVOLUTION Excel', serial: 'ISE2019A999000',
    room: 'Kitchen', purchaseDate: '2019-06-01', warrantyExpiry: '2029-06-01',
    warrantyProvider: 'InSinkErator 10-Year We Come To You', manualUrl: 'https://www.insinkerator.com/support',
    replacementCost: 380, repairIds: []
  },
  {
    id: 'a11', name: 'Garage Door Opener', make: 'Chamberlain', model: 'B550', serial: 'CH2020A111333',
    room: 'Garage', purchaseDate: '2020-02-10', warrantyExpiry: '2027-02-10',
    warrantyProvider: 'Chamberlain 7-Year Motor', manualUrl: 'https://www.chamberlaingroup.com/support/b550',
    replacementCost: 350, repairIds: []
  },
  {
    id: 'a12', name: 'Water Softener', make: 'Fleck', model: '5600SXT', serial: 'FLK2022A444555',
    room: 'Garage', purchaseDate: '2022-07-20', warrantyExpiry: '2032-07-20',
    warrantyProvider: 'Fleck 10-Year Valve/Tank', manualUrl: 'https://www.fleckwater.com/support/5600sxt',
    replacementCost: 800, repairIds: []
  },
  {
    id: 'a13', name: 'Smart Thermostat', make: 'Ecobee', model: 'SmartThermostat Premium', serial: 'ECB2023A666777',
    room: 'Hallway', purchaseDate: '2023-09-01', warrantyExpiry: '2025-09-01',
    warrantyProvider: 'Ecobee 2-Year', manualUrl: 'https://www.ecobee.com/support',
    replacementCost: 250, repairIds: []
  },
  {
    id: 'a14', name: 'Sump Pump', make: 'Zoeller', model: 'M267', serial: 'ZOE2021A888999',
    room: 'Basement', purchaseDate: '2021-03-01', warrantyExpiry: '2024-03-01',
    warrantyProvider: 'Zoeller 3-Year (Expired)', manualUrl: 'https://www.zoellerpumps.com/support/m267',
    replacementCost: 450, repairIds: ['r5']
  },
  {
    id: 'a15', name: 'Ceiling Fan (Master)', make: 'Hunter', model: 'Cavalli II', serial: 'HUN2022A000111',
    room: 'Master Bedroom', purchaseDate: '2022-05-14', warrantyExpiry: '2027-05-14',
    warrantyProvider: 'Hunter 5-Year Limited Motor', manualUrl: 'https://www.hunterfan.com/support',
    replacementCost: 280, repairIds: []
  }
];

export const SEED_REPAIRS: RepairRecord[] = [
  {
    id: 'r1', date: '2024-07-22', itemOrArea: 'Central AC Unit',
    issue: 'AC not cooling — compressor cycling on/off repeatedly',
    contractorId: 'c1', contractorName: 'Mike Rodriguez',
    cost: 485, partsUsed: ['Lennox dual run capacitor (45/5 MFD)', 'contactor relay'],
    resolution: 'Replaced failed dual run capacitor and worn contactor. System back to full cooling capacity.',
    warrantyCovered: false
  },
  {
    id: 'r2', date: '2023-09-10', itemOrArea: 'Kitchen Sink Plumbing',
    issue: 'Slow drain in kitchen, gurgling sound',
    contractorId: 'c3', contractorName: 'James Wilson',
    cost: 175, partsUsed: ['P-trap assembly', 'drain auger service'],
    resolution: 'Cleared grease buildup in drain line, replaced corroded P-trap. Advised against putting grease down drain.',
    warrantyCovered: false
  },
  {
    id: 'r3', date: '2025-01-08', itemOrArea: 'Samsung Refrigerator',
    issue: 'Ice maker not producing ice, water dispenser slow',
    contractorId: 'c1', contractorName: 'Mike Rodriguez',
    cost: 320, partsUsed: ['Samsung DA97-17376B ice maker assembly', 'water inlet valve'],
    resolution: 'Replaced ice maker assembly and water inlet valve. Ice production restored. Water pressure back to normal.',
    warrantyCovered: true
  },
  {
    id: 'r4', date: '2024-11-03', itemOrArea: 'Electrical Panel',
    issue: 'Breaker tripping when running microwave + dishwasher simultaneously',
    contractorId: 'c2', contractorName: 'Sarah Chen',
    cost: 2200, partsUsed: ['200A panel (Square D QO)', '40 breakers', 'new main feed wire'],
    resolution: 'Upgraded from 100A to 200A service panel. Added dedicated circuits for kitchen appliances. All circuits tested and balanced.',
    warrantyCovered: false
  },
  {
    id: 'r5', date: '2024-03-17', itemOrArea: 'Sump Pump',
    issue: 'Sump pump running continuously during rain, not keeping up',
    contractorId: 'c3', contractorName: 'James Wilson',
    cost: 620, partsUsed: ['Zoeller M267 replacement pump', 'check valve', 'PVC discharge pipe'],
    resolution: 'Original pump impeller was worn. Replaced entire pump unit, new check valve, rerouted discharge away from foundation.',
    warrantyCovered: false
  }
];

export const SEED_MAINTENANCE: MaintenanceTask[] = [
  {
    id: 'm1', task: 'Replace HVAC air filter', recurrence: 'monthly',
    lastDone: '2026-02-15', nextDue: '2026-03-15', category: 'HVAC',
    estimatedCost: 20, notes: 'Use MERV 11 filter, size 20x25x1. Buy in bulk from Amazon.', overdue: true
  },
  {
    id: 'm2', task: 'Professional HVAC tune-up', recurrence: 'yearly',
    lastDone: '2025-04-10', nextDue: '2026-04-10', category: 'HVAC',
    estimatedCost: 150, notes: 'Mike Rodriguez does this. Usually schedules in early April. He checks refrigerant, coils, and electrical connections.', overdue: false
  },
  {
    id: 'm3', task: 'Clean gutters and downspouts', recurrence: 'semi-annual',
    lastDone: '2025-11-01', nextDue: '2026-05-01', category: 'Exterior',
    estimatedCost: 200, notes: 'Lots of oak trees in neighborhood — gutters fill fast. Also check for loose hangers and seal leaks.', overdue: false
  },
  {
    id: 'm4', task: 'Flush water heater', recurrence: 'yearly',
    lastDone: '2025-06-20', nextDue: '2026-06-20', category: 'Plumbing',
    estimatedCost: 0, notes: 'DIY — attach garden hose to drain valve, flush until water runs clear. Check anode rod while at it.', overdue: false
  },
  {
    id: 'm5', task: 'Test smoke and CO detectors', recurrence: 'monthly',
    lastDone: '2026-03-01', nextDue: '2026-04-01', category: 'Safety',
    estimatedCost: 0, notes: 'Press test button on all units. Replace batteries in fall. Units are: hallway (2nd floor), kitchen, master bedroom, basement.', overdue: false
  },
  {
    id: 'm6', task: 'Inspect roof for damage', recurrence: 'yearly',
    lastDone: '2025-03-20', nextDue: '2026-03-20', category: 'Exterior',
    estimatedCost: 0, notes: 'Roof installed 2019 (architectural shingles, 30-year rated). Check for missing/damaged shingles, flashing around vents.', overdue: true
  },
  {
    id: 'm7', task: 'Clean dryer vent', recurrence: 'semi-annual',
    lastDone: '2025-09-15', nextDue: '2026-03-15', category: 'Appliance',
    estimatedCost: 0, notes: 'DIY — use dryer vent brush kit. Lint buildup is a fire hazard. Vent exits on north wall of house.', overdue: true
  },
  {
    id: 'm8', task: 'Service garage door (lube springs, check alignment)', recurrence: 'yearly',
    lastDone: '2025-05-01', nextDue: '2026-05-01', category: 'Garage',
    estimatedCost: 0, notes: 'Use lithium grease on tracks, springs, and hinges. Check safety sensors are aligned.', overdue: false
  },
  {
    id: 'm9', task: 'Winterize outdoor faucets', recurrence: 'yearly',
    lastDone: '2025-10-25', nextDue: '2026-10-25', category: 'Plumbing',
    estimatedCost: 0, notes: 'Disconnect all hoses, turn off interior shut-off valves, open outdoor faucets to drain. Cover with insulating caps.', overdue: false
  },
  {
    id: 'm10', task: 'Add water softener salt', recurrence: 'monthly',
    lastDone: '2026-03-10', nextDue: '2026-04-10', category: 'Plumbing',
    estimatedCost: 15, notes: 'Use Solar Salt pellets (blue bag from Home Depot). Keep brine tank at least 1/2 full. Fleck 5600SXT settings: hardness 18 gpg.', overdue: false
  }
];

export const SEED_INVENTORY: InventoryItem[] = [
  { id: 'i1', room: 'Kitchen', itemName: 'Granite Countertops', category: 'Surface', purchaseDate: '2019-03-15', warrantyExpiry: '2029-03-15', replacementCost: 5500, notes: 'Colonial Gold granite, 3cm slab. Sealed annually. Fabricator: Austin Stone Works.' },
  { id: 'i2', room: 'Kitchen', itemName: 'Cabinet Set', category: 'Storage', purchaseDate: '2019-03-15', warrantyExpiry: '2029-03-15', replacementCost: 12000, notes: 'Shaker style, soft-close hinges, painted white. Manufacturer: KraftMaid.' },
  { id: 'i3', room: 'Living Room', itemName: 'Hardwood Floors', category: 'Flooring', purchaseDate: '2019-03-15', warrantyExpiry: '2044-03-15', replacementCost: 8000, notes: 'White oak, engineered, wide plank (7"). Site-finished with Bona satin. Refinish every 10 years.' },
  { id: 'i4', room: 'Master Bedroom', itemName: 'Carpet', category: 'Flooring', purchaseDate: '2019-03-15', warrantyExpiry: '2029-03-15', replacementCost: 2500, notes: 'Stainmaster PetProtect, plush, color: Storm Gray. Professional clean every 18 months.' },
  { id: 'i5', room: 'All Bathrooms', itemName: 'Tile Flooring', category: 'Flooring', purchaseDate: '2019-03-15', warrantyExpiry: '2044-03-15', replacementCost: 3500, notes: 'Porcelain tile, 12x24, color: Artic White. Grout sealed 2023.' },
  { id: 'i6', room: 'Exterior', itemName: 'Roof', category: 'Structure', purchaseDate: '2019-04-01', warrantyExpiry: '2049-04-01', replacementCost: 15000, notes: 'GAF Timberline HDZ architectural shingles (30-year). Charcoal color. Installed by Austin Roofing Co. Warranty transferable.' },
  { id: 'i7', room: 'Garage', itemName: 'Garage Door', category: 'Exterior', purchaseDate: '2020-02-10', warrantyExpiry: '2030-02-10', replacementCost: 1800, notes: 'Clopay Classic, insulated, 16x7. Color: Sandstone. Springs replaced 2024 under warranty.' },
  { id: 'i8', room: 'Kitchen', itemName: 'Pendant Lights (set of 3)', category: 'Lighting', purchaseDate: '2020-09-01', warrantyExpiry: '2022-09-01', replacementCost: 450, notes: 'Brushed nickel, glass shade. From West Elm.' },
  { id: 'i9', room: 'Master Bathroom', itemName: 'Vanity Mirror', category: 'Fixture', purchaseDate: '2021-06-10', warrantyExpiry: '2023-06-10', replacementCost: 350, notes: 'Frameless, 36x28, LED backlit. Pottery Barn.' },
  { id: 'i10', room: 'Exterior', itemName: 'Privacy Fence', category: 'Exterior', purchaseDate: '2020-04-15', warrantyExpiry: '2030-04-15', replacementCost: 6000, notes: 'Cedar, 6ft, stain applied 2020 and 2023. Needs restaining every 3 years. Back and side yard — 200 linear ft.' },
  { id: 'i11', room: 'Backyard', itemName: 'Deck', category: 'Exterior', purchaseDate: '2019-06-20', warrantyExpiry: '2029-06-20', replacementCost: 8000, notes: 'Composite decking (Trex Transcend), 16x20. No staining needed. Clean annually with deck brush and soap.' },
  { id: 'i12', room: 'Basement', itemName: 'Dehumidifier', category: 'Appliance', purchaseDate: '2022-04-01', warrantyExpiry: '2024-04-01', replacementCost: 300, notes: 'Frigidaire 50-pint. Runs April-October. Clean filter monthly.' },
  { id: 'i13', room: 'Hallway', itemName: 'Smart Lock', category: 'Security', purchaseDate: '2023-01-15', warrantyExpiry: '2025-01-15', replacementCost: 280, notes: 'August Wi-Fi Smart Lock, 4th gen. Batteries (CR123A) last ~6 months. Replace by August 2026.' },
  { id: 'i14', room: 'Exterior', itemName: 'Sprinkler System', category: 'Irrigation', purchaseDate: '2019-05-10', warrantyExpiry: '2024-05-10', replacementCost: 3500, notes: 'Rain Bird, 6 zones. Controller in garage. Blow out lines before first freeze each year. Backflow preventer on south wall.' },
  { id: 'i15', room: 'Garage', itemName: 'EV Charger', category: 'Electrical', purchaseDate: '2023-03-01', warrantyExpiry: '2026-03-01', replacementCost: 600, notes: 'ChargePoint Home Flex, 50A circuit. Hardwired by Sarah Chen. Works with both our cars.' }
];

export const SEED_EXPENSES: ExpenseRecord[] = [
  { id: 'e1', date: '2024-07-22', category: 'repair', amount: 485, description: 'AC repair — capacitor and contactor replacement', relatedRepairId: 'r1' },
  { id: 'e2', date: '2023-09-10', category: 'repair', amount: 175, description: 'Kitchen sink drain clearing and P-trap replacement', relatedRepairId: 'r2' },
  { id: 'e3', date: '2025-01-08', category: 'repair', amount: 320, description: 'Refrigerator ice maker and water valve replacement (warranty covered — reimbursed)', relatedRepairId: 'r3' },
  { id: 'e4', date: '2024-11-03', category: 'improvement', amount: 2200, description: 'Electrical panel upgrade 100A → 200A', relatedRepairId: 'r4' },
  { id: 'e5', date: '2024-03-17', category: 'repair', amount: 620, description: 'Sump pump replacement', relatedRepairId: 'r5' },
  { id: 'e6', date: '2025-04-10', category: 'maintenance', amount: 150, description: 'Annual HVAC tune-up — Mike Rodriguez' },
  { id: 'e7', date: '2025-11-01', category: 'maintenance', amount: 200, description: 'Gutter cleaning — fall 2025' },
  { id: 'e8', date: '2025-06-20', category: 'maintenance', amount: 0, description: 'Water heater flush — DIY' },
  { id: 'e9', date: '2024-06-01', category: 'maintenance', amount: 350, description: 'Fence restaining — materials and labor' },
  { id: 'e10', date: '2025-01-15', category: 'utilities', amount: 285, description: 'Electric bill — January 2025' },
  { id: 'e11', date: '2025-02-15', category: 'utilities', amount: 310, description: 'Electric bill — February 2025' },
  { id: 'e12', date: '2025-03-15', category: 'utilities', amount: 245, description: 'Electric bill — March 2025' },
  { id: 'e13', date: '2025-04-15', category: 'utilities', amount: 195, description: 'Electric bill — April 2025' },
  { id: 'e14', date: '2025-05-15', category: 'utilities', amount: 210, description: 'Electric bill — May 2025' },
  { id: 'e15', date: '2025-06-15', category: 'utilities', amount: 320, description: 'Electric bill — June 2025 (AC season)' },
  { id: 'e16', date: '2025-07-15', category: 'utilities', amount: 385, description: 'Electric bill — July 2025 (peak AC)' },
  { id: 'e17', date: '2025-08-15', category: 'utilities', amount: 360, description: 'Electric bill — August 2025' },
  { id: 'e18', date: '2025-09-15', category: 'utilities', amount: 260, description: 'Electric bill — September 2025' },
  { id: 'e19', date: '2025-10-15', category: 'utilities', amount: 195, description: 'Electric bill — October 2025' },
  { id: 'e20', date: '2025-11-15', category: 'utilities', amount: 180, description: 'Electric bill — November 2025' },
  { id: 'e21', date: '2025-12-15', category: 'utilities', amount: 230, description: 'Electric bill — December 2025 (heating)' },
  { id: 'e22', date: '2025-06-15', category: 'utilities', amount: 85, description: 'Water bill — June 2025' },
  { id: 'e23', date: '2025-01-01', category: 'insurance', amount: 2100, description: 'Homeowners insurance — annual premium 2025' },
  { id: 'e24', date: '2025-09-15', category: 'maintenance', amount: 12, description: 'Dryer vent cleaning brush — DIY' },
  { id: 'e25', date: '2026-02-15', category: 'maintenance', amount: 20, description: 'HVAC filter replacement — MERV 11' }
];

export function getSeedData(): HomeData {
  return {
    inventory: [...SEED_INVENTORY],
    repairs: [...SEED_REPAIRS],
    maintenance: [...SEED_MAINTENANCE],
    contractors: [...SEED_CONTRACTORS],
    appliances: [...SEED_APPLIANCES],
    expenses: [...SEED_EXPENSES]
  };
}
