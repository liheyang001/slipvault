import * as SQLite from 'expo-sqlite';
import { Invoice, NewInvoice, SearchFilters } from '../types/invoice';
import { generateId } from '../utils/id';
import { DEFAULT_CATEGORIES } from '../utils/categories';

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
      tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'done',
      warrantyMonths INTEGER DEFAULT 0,
      warrantyNotifId TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor);
    CREATE INDEX IF NOT EXISTS idx_invoices_total ON invoices(total);
    CREATE TABLE IF NOT EXISTS user_categories (
      name TEXT PRIMARY KEY
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
    `INSERT INTO invoices (id, photoUri, ocrText, vendor, date, items, subtotal, tax, total, category, tags, status, warrantyMonths, warrantyNotifId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    if (k === 'items' || k === 'tags') return JSON.stringify(v);
    if (typeof v === 'number') return v;
    return String(v ?? '');
  });

  db.runSync(
    `UPDATE invoices SET ${fields}, updatedAt = ? WHERE id = ?`,
    [...values, now, id] as (string | number)[]
  );
}

export function deleteInvoice(id: string): void {
  db.runSync('DELETE FROM invoices WHERE id = ?', [id]);
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

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM invoices ${where} ORDER BY date DESC, createdAt DESC`,
    params
  );

  return rows.map(deserializeInvoice);
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

// ─── Scan quota ───────────────────────────────────────────────────────────────

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

function deserializeInvoice(row: Record<string, unknown>): Invoice {
  return {
    ...(row as unknown as Invoice),
    items: JSON.parse((row.items as string) || '[]'),
    tags: JSON.parse((row.tags as string) || '[]'),
  };
}
