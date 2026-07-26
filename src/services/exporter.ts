import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Invoice } from '../types/invoice';
import { capitalize } from '../utils/categories';
import { capitalizeRoom } from '../utils/rooms';
import { formatNZDate } from '../utils/dates';

// ─── CSV ─────────────────────────────────────────────────────────────────────

function escapeCSV(value: string | number | undefined): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportCSV(invoices: Invoice[]): Promise<void> {
  const header = ['Purchase Date', 'Merchant', 'Category', 'Brand', 'Model', 'Serial', 'Excl. GST', 'GST', 'Incl. GST', 'Items'];
  const rows = invoices.map((inv) => {
    const itemsSummary = inv.items
      .map((it) => `${it.name} x${it.quantity}`)
      .join(' | ');
    return [
      escapeCSV(inv.date),
      escapeCSV(inv.vendor),
      escapeCSV(capitalize(inv.category)),
      escapeCSV(inv.brand ?? ''),
      escapeCSV(inv.model ?? ''),
      escapeCSV(inv.serialNumber ?? ''),
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
        <td>${formatNZDate(inv.date) || '—'}</td>
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
        <th>Purchase Date</th>
        <th>Merchant</th>
        <th>Category</th>
        <th class="num">Excl. GST</th>
        <th class="num">GST</th>
        <th class="num">Incl. GST</th>
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

// ─── Insurance inventory (per room) ───────────────────────────────────────────

function safeFileName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'room';
}

/** CSV of a single room's invoices, including itemized lines, for an insurance claim. */
export async function exportRoomCSV(invoices: Invoice[], roomName: string): Promise<void> {
  const header = ['Room', 'Purchase Date', 'Merchant', 'Brand', 'Model', 'Serial', 'Item', 'Quantity', 'Item Total', 'Invoice Total (incl. GST)'];
  const rows: string[] = [];
  for (const inv of invoices) {
    const ident = [
      escapeCSV(inv.brand ?? ''),
      escapeCSV(inv.model ?? ''),
      escapeCSV(inv.serialNumber ?? ''),
    ];
    if (inv.items.length === 0) {
      rows.push([
        escapeCSV(capitalizeRoom(roomName)),
        escapeCSV(inv.date),
        escapeCSV(inv.vendor),
        ...ident,
        escapeCSV('—'),
        escapeCSV(''),
        escapeCSV(''),
        escapeCSV(inv.total.toFixed(2)),
      ].join(','));
    } else {
      inv.items.forEach((it, i) => {
        rows.push([
          escapeCSV(capitalizeRoom(roomName)),
          escapeCSV(inv.date),
          escapeCSV(inv.vendor),
          ...ident,
          escapeCSV(it.name),
          escapeCSV(it.quantity),
          escapeCSV(it.totalPrice.toFixed(2)),
          escapeCSV(i === 0 ? inv.total.toFixed(2) : ''),
        ].join(','));
      });
    }
  }

  const csv = [header.join(','), ...rows].join('\n');
  const fileName = `insurance_${safeFileName(roomName)}_${new Date().toISOString().slice(0, 10)}.csv`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
}

function buildRoomPDFHtml(invoices: Invoice[], roomName: string): string {
  const totalSum = invoices.reduce((s, inv) => s + inv.total, 0);

  const blocks = invoices
    .map((inv) => {
      const itemRows =
        inv.items.length > 0
          ? inv.items
              .map(
                (it) => `
        <tr>
          <td>${it.name || '—'}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">$${(it.totalPrice ?? 0).toFixed(2)}</td>
        </tr>`
              )
              .join('')
          : `<tr><td colspan="3" class="muted">No itemized details</td></tr>`;
      const identParts = [inv.brand, inv.model].filter(Boolean).join(' ');
      const identLine =
        identParts || inv.serialNumber
          ? `<div class="ident">${identParts}${
              identParts && inv.serialNumber ? ' · ' : ''
            }${inv.serialNumber ? `S/N: ${inv.serialNumber}` : ''}</div>`
          : '';
      return `
      <div class="invoice">
        <div class="inv-head">
          <span class="vendor">${inv.vendor || 'Unknown'}</span>
          <span class="date">${formatNZDate(inv.date) || '—'}</span>
        </div>
        ${identLine}
        <table class="items">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="inv-total">Total (incl. GST): <strong>$${inv.total.toFixed(2)}</strong></div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica Neue, sans-serif; font-size: 13px; color: #1f2937; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
    .room { font-size: 16px; color: #2563eb; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
    .invoice { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .inv-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .vendor { font-weight: 700; font-size: 14px; }
    .date { color: #6b7280; font-size: 12px; }
    .ident { color: #374151; font-size: 12px; margin: -4px 0 8px; }
    table.items { width: 100%; border-collapse: collapse; }
    .items th { text-align: left; padding: 6px 8px; background: #f9fafb; font-size: 10px; font-weight: 700;
         color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .items td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #9ca3af; font-style: italic; }
    .inv-total { text-align: right; margin-top: 8px; font-size: 12px; color: #374151; }
    .summary { margin-top: 20px; text-align: right; font-size: 14px; }
    .summary span { font-weight: 700; color: #2563eb; font-size: 18px; margin-left: 8px; }
    footer { margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <h1>Insurance Inventory</h1>
  <p class="room">${capitalizeRoom(roomName)}</p>
  <p class="meta">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} &nbsp;·&nbsp; ${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}</p>
  ${blocks}
  <div class="summary">
    Declared value: <span>$${totalSum.toFixed(2)}</span>
  </div>
  <footer>Slipvault &nbsp;·&nbsp; All data stored locally on your device</footer>
</body>
</html>`;
}

/** PDF inventory of a single room's invoices for an insurance claim. */
export async function exportRoomPDF(invoices: Invoice[], roomName: string): Promise<void> {
  const html = buildRoomPDFHtml(invoices, roomName);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  const fileName = `insurance_${safeFileName(roomName)}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const destUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.moveAsync({ from: uri, to: destUri });

  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
