import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Invoice } from '../types/invoice';
import { capitalize } from '../utils/categories';

// ─── CSV ─────────────────────────────────────────────────────────────────────

function escapeCSV(value: string | number | undefined): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportCSV(invoices: Invoice[]): Promise<void> {
  const header = ['Date', 'Merchant', 'Category', 'Subtotal', 'Tax', 'Total', 'Items'];
  const rows = invoices.map((inv) => {
    const itemsSummary = inv.items
      .map((it) => `${it.name} x${it.quantity}`)
      .join(' | ');
    return [
      escapeCSV(inv.date),
      escapeCSV(inv.vendor),
      escapeCSV(capitalize(inv.category)),
      escapeCSV(inv.subtotal.toFixed(2)),
      escapeCSV(inv.tax.toFixed(2)),
      escapeCSV(inv.total.toFixed(2)),
      escapeCSV(itemsSummary),
    ].join(',');
  });

  const csv = [header.join(','), ...rows].join('\n');
  const fileName = `invoices_${new Date().toISOString().slice(0, 10)}.csv`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

function buildPDFHtml(invoices: Invoice[]): string {
  const totalSum = invoices.reduce((s, inv) => s + inv.total, 0);

  const rows = invoices
    .map(
      (inv) => `
      <tr>
        <td>${inv.date || '—'}</td>
        <td>${inv.vendor || 'Unknown'}</td>
        <td><span class="badge">${capitalize(inv.category) || 'Other'}</span></td>
        <td class="num">$${inv.subtotal.toFixed(2)}</td>
        <td class="num">$${inv.tax.toFixed(2)}</td>
        <td class="num total-cell">$${inv.total.toFixed(2)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica Neue, sans-serif; font-size: 13px; color: #1f2937; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 10px; background: #f3f4f6; font-size: 11px; font-weight: 700;
         color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; }
    td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .total-cell { font-weight: 700; color: #2563eb; }
    .badge { display: inline-block; background: #eff6ff; color: #2563eb; padding: 2px 8px;
             border-radius: 10px; font-size: 11px; font-weight: 600; }
    .summary { margin-top: 20px; text-align: right; font-size: 14px; }
    .summary span { font-weight: 700; color: #2563eb; font-size: 16px; margin-left: 8px; }
    footer { margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <h1>Invoice Report</h1>
  <p class="meta">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} &nbsp;·&nbsp; ${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Merchant</th>
        <th>Category</th>
        <th class="num">Subtotal</th>
        <th class="num">Tax</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="summary">
    Total spent: <span>$${totalSum.toFixed(2)}</span>
  </div>
  <footer>Slipvault &nbsp;·&nbsp; All data stored locally on your device</footer>
</body>
</html>`;
}

export async function exportPDF(invoices: Invoice[]): Promise<void> {
  const html = buildPDFHtml(invoices);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  const fileName = `invoices_${new Date().toISOString().slice(0, 10)}.pdf`;
  const destUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.moveAsync({ from: uri, to: destUri });

  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
