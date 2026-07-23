// New Zealand GST — used to keep the Excl./Incl. GST fields in sync when editing.
export const GST_RATE = 0.15;

export function exclFromIncl(incl: number): number {
  return Math.round((incl / (1 + GST_RATE)) * 100) / 100;
}

export function inclFromExcl(excl: number): number {
  return Math.round(excl * (1 + GST_RATE) * 100) / 100;
}
