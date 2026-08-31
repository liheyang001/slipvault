import { asExtractedInvoiceData, MalformedExtractionError } from '../src/utils/extraction';

const valid = {
  isInvoice: true,
  vendor: 'Countdown',
  date: '2026-08-01',
  items: [{ name: 'Bread', quantity: 1, unitPrice: 4.5, totalPrice: 4.5 }],
  subtotal: 17.39,
  tax: 2.61,
  total: 20,
  category: 'groceries',
};

describe('asExtractedInvoiceData', () => {
  it('passes a well-formed payload through', () => {
    expect(asExtractedInvoiceData(valid)).toEqual(valid);
  });

  // The shipped bug: `as ExtractedInvoiceData` is erased at runtime, so a
  // missing total became NaN, was stored, and turned every sum in the app NaN.
  it.each(['total', 'subtotal', 'tax'])('rejects a payload missing %s', (field) => {
    const broken: Record<string, unknown> = { ...valid };
    delete broken[field];
    expect(() => asExtractedInvoiceData(broken)).toThrow(MalformedExtractionError);
  });

  it.each([NaN, Infinity, -Infinity, '20.00', null])('rejects a total of %p', (total) => {
    expect(() => asExtractedInvoiceData({ ...valid, total })).toThrow(MalformedExtractionError);
  });

  it('rejects negative amounts', () => {
    expect(() => asExtractedInvoiceData({ ...valid, total: -1 })).toThrow(MalformedExtractionError);
  });

  it.each([null, undefined, [], 'a string', 42])('rejects %p as the payload', (raw) => {
    expect(() => asExtractedInvoiceData(raw)).toThrow(MalformedExtractionError);
  });

  it('rejects a payload with no isInvoice flag', () => {
    const { isInvoice, ...rest } = valid;
    expect(() => asExtractedInvoiceData(rest)).toThrow(MalformedExtractionError);
  });

  // Not a failure: the user photographed something that is not a receipt and
  // the model correctly said so. Amounts are zeroed, not validated.
  it('accepts isInvoice:false with empty amounts', () => {
    const result = asExtractedInvoiceData({ isInvoice: false, vendor: '', date: '', category: '' });
    expect(result).toEqual({
      isInvoice: false, vendor: '', date: '', category: '',
      items: [], subtotal: 0, tax: 0, total: 0,
    });
  });

  it('coerces bad item rows rather than letting NaN into a total', () => {
    const result = asExtractedInvoiceData({
      ...valid,
      items: [{ name: 'X' }, { name: 'Y', quantity: 'two', totalPrice: NaN }, null, 'junk'],
    });
    expect(result.items).toEqual([
      { name: 'X', quantity: 1, unitPrice: 0, totalPrice: 0 },
      { name: 'Y', quantity: 1, unitPrice: 0, totalPrice: 0 },
    ]);
    expect(result.items.every((i) => Number.isFinite(i.totalPrice))).toBe(true);
  });

  it('defaults missing text fields to empty strings', () => {
    const result = asExtractedInvoiceData({ isInvoice: true, subtotal: 0, tax: 0, total: 0 });
    expect(result.vendor).toBe('');
    expect(result.date).toBe('');
    expect(result.items).toEqual([]);
  });
});
