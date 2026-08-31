import { exclFromInclAt, inclFromExclAt, taxFromInclAt, TAX_PRESETS } from '../src/utils/taxMath';

describe('tax arithmetic', () => {
  // The shipped bug: manual entry stored the tax-inclusive amount as the
  // excl. figure with zero tax, so a $20 item read back as $20 excl. GST.
  it('splits a tax-inclusive amount at the NZ rate', () => {
    expect(exclFromInclAt(20, 15)).toBe(17.39);
    expect(taxFromInclAt(20, 15)).toBe(2.61);
  });

  it('keeps the three figures adding up at every preset rate', () => {
    for (const { country, percent } of TAX_PRESETS) {
      for (const total of [20, 19.99, 0.01, 1234.56, 999999.99]) {
        const excl = exclFromInclAt(total, percent);
        const tax = taxFromInclAt(total, percent);
        expect({ country, total, sum: Math.round((excl + tax) * 100) / 100 }).toEqual({
          country,
          total,
          sum: total,
        });
      }
    }
  });

  it('is a no-op at a zero rate', () => {
    expect(exclFromInclAt(20, 0)).toBe(20);
    expect(taxFromInclAt(20, 0)).toBe(0);
  });

  it('round-trips excl → incl → excl', () => {
    for (const percent of [15, 10, 20, 23, 5]) {
      expect(exclFromInclAt(inclFromExclAt(100, percent), percent)).toBe(100);
    }
  });

  it('treats zero as zero rather than producing NaN', () => {
    expect(exclFromInclAt(0, 15)).toBe(0);
    expect(taxFromInclAt(0, 15)).toBe(0);
  });
});
