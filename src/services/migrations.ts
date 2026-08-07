// One-off data repairs, as opposed to the schema migrations in database.ts.
//
// Those are DDL and idempotent by nature — re-running an ALTER that already
// applied just throws and is swallowed. These rewrite rows, so re-running one
// would compound its own effect. Each therefore records a completion flag and
// checks it first.
//
// Lives here rather than in database.ts because repairs need the domain rules
// (tax rates, categories) and database.ts sits underneath those.
import { getSetting, setSetting, getAllInvoices, updateInvoice } from './database';
import { exclFromIncl, taxFromIncl } from '../utils/tax';

const MANUAL_TAX_BACKFILL_KEY = 'migration.manualTaxSplit';

/**
 * Hand-added items saved before the tax split was fixed stored the
 * tax-inclusive amount in `subtotal` with `tax` at 0, so every one of them
 * read back as untaxed.
 *
 * Only rows that still carry that exact signature are touched:
 *   - no receipt photo   → it came from manual entry
 *   - subtotal === total → nobody has corrected it since
 *   - tax === 0          → it was never split
 *
 * Scanned invoices are deliberately left alone at any rate: their subtotal is
 * what the receipt actually said, and recomputing it would replace a real
 * figure with a derived guess.
 *
 * Uses whatever rate is configured when it runs. A user who later changes
 * their rate keeps these values — same rule as everywhere else, stored
 * amounts are never silently rewritten twice.
 */
export function backfillManualEntryTax(): number {
  if (getSetting(MANUAL_TAX_BACKFILL_KEY, '') === 'done') return 0;

  let repaired = 0;
  for (const inv of getAllInvoices()) {
    const untouchedManualEntry =
      !inv.photoUri && inv.total > 0 && inv.tax === 0 && inv.subtotal === inv.total;
    if (!untouchedManualEntry) continue;

    const subtotal = exclFromIncl(inv.total);
    // At a 0% rate the split is a no-op; writing it back would be churn.
    if (subtotal === inv.total) continue;

    updateInvoice(inv.id, { subtotal, tax: taxFromIncl(inv.total) });
    repaired++;
  }

  setSetting(MANUAL_TAX_BACKFILL_KEY, 'done');
  return repaired;
}

/** Runs every outstanding repair. Safe to call on every launch. */
export function runDataMigrations(): void {
  backfillManualEntryTax();
}
