import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Invoice, NewInvoice, SearchFilters } from '../types/invoice';
import { generateId } from '../utils/id';
import { DEFAULT_CATEGORIES } from '../utils/categories';
import { DEFAULT_ROOMS } from '../utils/rooms';

const db = SQLite.openDatabaseSync('invoices.db');

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      photoUri TEXT NOT NULL,
      ocrText TEXT,
      vendor TEXT,
      date TEXT,
      items TEXT,
      subtotal REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL DEFAULT 0,
      category TEXT DEFAULT '',
      room TEXT DEFAULT '',
      itemPhotos TEXT DEFAULT '[]',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serialNumber TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'done',
      warrantyMonths INTEGER DEFAULT 0,
      warrantyNotifId TEXT DEFAULT '',
      note TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor);
    CREATE INDEX IF NOT EXISTS idx_invoices_total ON invoices(total);
    CREATE TABLE IF NOT EXISTS user_categories (
      name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS user_rooms (
      name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS category_taps (
      name TEXT PRIMARY KEY,
      taps INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ai_valuations (
      invoiceId TEXT NOT NULL,
      itemIndex INTEGER NOT NULL,
      value REAL NOT NULL,
      note TEXT DEFAULT '',
      valuedAt TEXT NOT NULL,
      PRIMARY KEY (invoiceId, itemIndex)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migrations for existing databases
  const migrations = [
    `ALTER TABLE invoices ADD COLUMN status TEXT DEFAULT 'done'`,
    `ALTER TABLE invoices ADD COLUMN warrantyMonths INTEGER DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN warrantyNotifId TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN room TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN itemPhotos TEXT DEFAULT '[]'`,
    `ALTER TABLE invoices ADD COLUMN brand TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN model TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN serialNumber TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN note TEXT DEFAULT ''`,
  ];
  for (const sql of migrations) {
    try { db.execSync(sql); } catch { /* column already exists */ }
  }
}

// ─── User categories ────────────────────────────────────────────────────────

export function getUserCategories(): string[] {
  const rows = db.getAllSync<{ name: string }>(
    'SELECT name FROM user_categories ORDER BY name ASC'
  );
  return rows.map((r) => r.name);
}

/** Save a custom category. No-op if it already exists in defaults or user table. */
export function saveUserCategory(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized || DEFAULT_CATEGORIES.includes(normalized)) return;
  db.runSync('INSERT OR IGNORE INTO user_categories (name) VALUES (?)', [normalized]);
}

export function deleteUserCategory(name: string): void {
  db.runSync('DELETE FROM user_categories WHERE name = ?', [name.toLowerCase()]);
}

// ─── User rooms ──────────────────────────────────────────────────────────────

export function getUserRooms(): string[] {
  const rows = db.getAllSync<{ name: string }>(
    'SELECT name FROM user_rooms ORDER BY name ASC'
  );
  return rows.map((r) => r.name);
}

/** Save a custom room. No-op if it already exists in defaults or user table. */
export function saveUserRoom(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized || DEFAULT_ROOMS.includes(normalized)) return;
  db.runSync('INSERT OR IGNORE INTO user_rooms (name) VALUES (?)', [normalized]);
}

export function deleteUserRoom(name: string): void {
  db.runSync('DELETE FROM user_rooms WHERE name = ?', [name.toLowerCase()]);
}

/** Move every invoice in one room to another. Returns the number of invoices moved. */
export function moveRoomInvoices(fromRoom: string, toRoom: string): number {
  const result = db.runSync(
    `UPDATE invoices SET room = ?, updatedAt = ? WHERE LOWER(TRIM(room)) = LOWER(TRIM(?))`,
    [toRoom.trim().toLowerCase(), new Date().toISOString(), fromRoom]
  );
  return result.changes;
}

/** Distinct non-empty rooms actually used by at least one invoice, with counts and totals. */
export function getRoomSummaries(): { room: string; count: number; total: number }[] {
  const rows = db.getAllSync<{ room: string; count: number; total: number }>(
    `SELECT LOWER(room) as room, COUNT(*) as count, SUM(total) as total
     FROM invoices
     WHERE (status IS NULL OR status = 'done')
       AND room IS NOT NULL
       AND TRIM(room) != ''
     GROUP BY LOWER(room)
     ORDER BY room ASC`
  );
  return rows.map((r) => ({ room: r.room, count: r.count, total: r.total ?? 0 }));
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export function insertInvoice(data: NewInvoice): Invoice {
  const now = new Date().toISOString();
  const invoice: Invoice = {
    ...data,
    id: generateId(),
    status: data.status ?? 'done',
    createdAt: now,
    updatedAt: now,
  };

  db.runSync(
    `INSERT INTO invoices (id, photoUri, ocrText, vendor, date, items, subtotal, tax, total, category, room, itemPhotos, brand, model, serialNumber, note, tags, status, warrantyMonths, warrantyNotifId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoice.id,
      invoice.photoUri,
      invoice.ocrText,
      invoice.vendor,
      invoice.date,
      JSON.stringify(invoice.items),
      invoice.subtotal,
      invoice.tax,
      invoice.total,
      invoice.category,
      invoice.room ?? '',
      JSON.stringify(invoice.itemPhotos ?? []),
      invoice.brand ?? '',
      invoice.model ?? '',
      invoice.serialNumber ?? '',
      invoice.note ?? '',
      JSON.stringify(invoice.tags),
      invoice.status ?? 'done',
      invoice.warrantyMonths ?? 0,
      invoice.warrantyNotifId ?? '',
      invoice.createdAt,
      invoice.updatedAt,
    ]
  );

  return invoice;
}

export function updateInvoice(id: string, data: Partial<NewInvoice>): void {
  const now = new Date().toISOString();
  const fields = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ');

  const values: (string | number)[] = Object.entries(data).map(([k, v]) => {
    if (k === 'items' || k === 'tags' || k === 'itemPhotos') return JSON.stringify(v);
    if (typeof v === 'number') return v;
    return String(v ?? '');
  });

  db.runSync(
    `UPDATE invoices SET ${fields}, updatedAt = ? WHERE id = ?`,
    [...values, now, id] as (string | number)[]
  );
}

export function deleteInvoice(id: string): void {
  const invoice = getInvoiceById(id);
  db.runSync('DELETE FROM invoices WHERE id = ?', [id]);
  db.runSync('DELETE FROM ai_valuations WHERE invoiceId = ?', [id]);
  // Clean up photo files (fire-and-forget)
  if (invoice) {
    for (const uri of [invoice.photoUri, ...(invoice.itemPhotos ?? [])]) {
      if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
}

// ─── AI valuations (contents insurance) ──────────────────────────────────────

export interface AIValuationRow {
  invoiceId: string;
  itemIndex: number; // -1 = whole invoice (itemless receipts)
  value: number;
  note: string;
  valuedAt: string;
}

export function saveAIValuation(
  invoiceId: string,
  itemIndex: number,
  value: number,
  note: string
): void {
  db.runSync(
    `INSERT OR REPLACE INTO ai_valuations (invoiceId, itemIndex, value, note, valuedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [invoiceId, itemIndex, value, note, new Date().toISOString()]
  );
}

export function getAIValuations(): AIValuationRow[] {
  return db.getAllSync<AIValuationRow>('SELECT * FROM ai_valuations');
}

export function getInvoiceById(id: string): Invoice | null {
  const row = db.getFirstSync<Record<string, unknown>>(
    'SELECT * FROM invoices WHERE id = ?',
    [id]
  );
  return row ? deserializeInvoice(row) : null;
}

export function searchInvoices(filters: SearchFilters = {}): Invoice[] {
  const conditions: string[] = ["(status IS NULL OR status = 'done')"];
  const params: (string | number)[] = [];

  if (filters.query) {
    conditions.push("(vendor LIKE ? OR ocrText LIKE ? OR items LIKE ?)");
    const like = `%${filters.query}%`;
    params.push(like, like, like);
  }
  if (filters.dateFrom) {
    conditions.push('date >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('date <= ?');
    params.push(filters.dateTo);
  }
  if (filters.minTotal !== undefined) {
    conditions.push('total >= ?');
    params.push(filters.minTotal);
  }
  if (filters.maxTotal !== undefined) {
    conditions.push('total <= ?');
    params.push(filters.maxTotal);
  }
  if (filters.category) {
    // Case-insensitive match so 'Toy' and 'toy' both work
    conditions.push('LOWER(category) = LOWER(?)');
    params.push(filters.category);
  }
  if (filters.room) {
    conditions.push('LOWER(room) = LOWER(?)');
    params.push(filters.room);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM invoices ${where} ORDER BY date DESC, createdAt DESC`,
    params
  );

  return rows.map(deserializeInvoice);
}

/** Counts a user tap on a category filter — powers the personalized quick chips. */
export function bumpCategoryTap(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return;
  db.runSync(
    `INSERT INTO category_taps (name, taps) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET taps = taps + 1`,
    [normalized]
  );
}

/**
 * Categories in use, ranked by how often the USER taps them (filter usage),
 * falling back to invoice count for categories never tapped yet.
 */
export function getCategoryUsage(): { category: string; count: number; taps: number }[] {
  return db.getAllSync<{ category: string; count: number; taps: number }>(
    `SELECT LOWER(i.category) as category, COUNT(*) as count, COALESCE(t.taps, 0) as taps
     FROM invoices i
     LEFT JOIN category_taps t ON t.name = LOWER(i.category)
     WHERE (i.status IS NULL OR i.status = 'done')
       AND i.category IS NOT NULL
       AND TRIM(i.category) != ''
     GROUP BY LOWER(i.category)
     ORDER BY taps DESC, count DESC, MAX(i.createdAt) DESC`
  );
}

/** Returns distinct non-empty categories that are actually used by at least one invoice. */
export function getUsedCategories(): string[] {
  const rows = db.getAllSync<{ category: string }>(
    `SELECT DISTINCT LOWER(category) as category
     FROM invoices
     WHERE (status IS NULL OR status = 'done')
       AND category IS NOT NULL
       AND TRIM(category) != ''
     ORDER BY category ASC`
  );
  return rows.map((r) => r.category);
}

export function getPendingInvoices(): Invoice[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM invoices WHERE status = 'pending' ORDER BY createdAt ASC`
  );
  return rows.map(deserializeInvoice);
}

export function findDuplicateInvoice(vendor: string, date: string, total: number): Invoice | null {
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM invoices
     WHERE LOWER(TRIM(vendor)) = LOWER(TRIM(?))
       AND date = ?
       AND ABS(total - ?) < 0.01
       AND (status IS NULL OR status = 'done')
     LIMIT 1`,
    [vendor, date, total]
  );
  return row ? deserializeInvoice(row) : null;
}

export function getAllInvoices(): Invoice[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM invoices ORDER BY date DESC, createdAt DESC'
  );
  return rows.map(deserializeInvoice);
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getSetting(key: string, defaultValue: string = ''): string {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

export function setSetting(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

// ─── Free plan quota ─────────────────────────────────────────────────────────

/** Free plan: up to this many stored invoices. Pro = unlimited. */
export const FREE_INVOICE_LIMIT = 20;

/** Total invoices currently stored (pending ones occupy slots too). */
export function getInvoiceCount(): number {
  const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) as c FROM invoices');
  return row?.c ?? 0;
}

export const FREE_SCAN_LIMIT = 15;

export function isProUser(): boolean {
  return getSetting('isPro', 'false') === 'true';
}

export function setProUser(value: boolean): void {
  setSetting('isPro', value ? 'true' : 'false');
}

export function getScansUsedThisMonth(): number {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storedMonth = getSetting('scanMonth', '');
  if (storedMonth !== thisMonth) {
    setSetting('scanMonth', thisMonth);
    setSetting('scanCount', '0');
    return 0;
  }
  return parseInt(getSetting('scanCount', '0'), 10);
}

export function incrementScanCount(): void {
  const used = getScansUsedThisMonth();
  setSetting('scanCount', String(used + 1));
}

// ─── Backup / restore ────────────────────────────────────────────────────────

export interface BackupData {
  version: number;
  exportedAt: string;
  invoices: Invoice[];
  userCategories: string[];
  userRooms: string[];
  aiValuations: AIValuationRow[];
  categoryTaps: { name: string; taps: number }[];
  settings: { key: string; value: string }[];
}

export function exportAllData(): BackupData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    invoices: getAllInvoices(),
    userCategories: getUserCategories(),
    userRooms: getUserRooms(),
    aiValuations: getAIValuations(),
    categoryTaps: db.getAllSync<{ name: string; taps: number }>(
      'SELECT name, taps FROM category_taps'
    ),
    settings: db.getAllSync<{ key: string; value: string }>('SELECT key, value FROM settings'),
  };
}

/** Imports a backup. Invoices with the same id are overwritten; everything else merges. */
export function importBackupData(data: BackupData): { invoices: number } {
  let count = 0;
  db.execSync('BEGIN TRANSACTION');
  try {
    for (const inv of data.invoices ?? []) {
      db.runSync(
        `INSERT OR REPLACE INTO invoices (id, photoUri, ocrText, vendor, date, items, subtotal, tax, total, category, room, itemPhotos, brand, model, serialNumber, note, tags, status, warrantyMonths, warrantyNotifId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inv.id,
          inv.photoUri ?? '',
          inv.ocrText ?? '',
          inv.vendor ?? '',
          inv.date ?? '',
          JSON.stringify(inv.items ?? []),
          inv.subtotal ?? 0,
          inv.tax ?? 0,
          inv.total ?? 0,
          inv.category ?? '',
          inv.room ?? '',
          JSON.stringify(inv.itemPhotos ?? []),
          inv.brand ?? '',
          inv.model ?? '',
          inv.serialNumber ?? '',
          inv.note ?? '',
          JSON.stringify(inv.tags ?? []),
          inv.status ?? 'done',
          inv.warrantyMonths ?? 0,
          '', // old notification ids are invalid on this device
          inv.createdAt ?? new Date().toISOString(),
          inv.updatedAt ?? new Date().toISOString(),
        ]
      );
      count++;
    }
    for (const c of data.userCategories ?? []) {
      db.runSync('INSERT OR IGNORE INTO user_categories (name) VALUES (?)', [c]);
    }
    for (const r of data.userRooms ?? []) {
      db.runSync('INSERT OR IGNORE INTO user_rooms (name) VALUES (?)', [r]);
    }
    for (const v of data.aiValuations ?? []) {
      db.runSync(
        'INSERT OR REPLACE INTO ai_valuations (invoiceId, itemIndex, value, note, valuedAt) VALUES (?, ?, ?, ?, ?)',
        [v.invoiceId, v.itemIndex, v.value, v.note ?? '', v.valuedAt]
      );
    }
    for (const t of data.categoryTaps ?? []) {
      db.runSync('INSERT OR IGNORE INTO category_taps (name, taps) VALUES (?, ?)', [
        t.name,
        t.taps,
      ]);
    }
    for (const s of data.settings ?? []) {
      db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }
    db.execSync('COMMIT');
  } catch (e) {
    db.execSync('ROLLBACK');
    throw e;
  }
  return { invoices: count };
}

function deserializeInvoice(row: Record<string, unknown>): Invoice {
  return {
    ...(row as unknown as Invoice),
    items: JSON.parse((row.items as string) || '[]'),
    tags: JSON.parse((row.tags as string) || '[]'),
    itemPhotos: JSON.parse((row.itemPhotos as string) || '[]'),
  };
}
