import Purchases, { PurchasesPackage } from 'react-native-purchases';

/** Configure once at app start. No-op without a key so builds that have no
 * RevenueCat configuration still run. */
export function configurePurchases(): void {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey });
}

/** Ties purchases to the Google identity the credit ledger is keyed on, so the
 * webhook's app_user_id matches the ledger's user_id. Without this a purchase
 * arrives under an anonymous ID and the credits land somewhere the user can
 * never reach. */
export async function linkPurchasesToUser(googleSub: string): Promise<void> {
  if (!process.env.EXPO_PUBLIC_REVENUECAT_KEY) return;
  try {
    await Purchases.logIn(googleSub);
  } catch {
    // Best-effort at sign-in; the Paywall verifies identity again before buying.
  }
}

/** The credit packs on offer, cheapest first. Prices come from the store, so
 * they are already localised and reflect any live promotion. */
export async function getCreditPacks(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  return [...packages].sort((a, b) => a.product.price - b.product.price);
}

/** Launches the store purchase sheet. Resolves once payment completes —
 * credits arrive separately via the webhook. */
export async function buyPack(pack: PurchasesPackage): Promise<void> {
  await Purchases.purchasePackage(pack);
}

/** True when the user dismissed the store sheet rather than hitting an error. */
export function isUserCancelled(err: unknown): boolean {
  return !!(err as { userCancelled?: boolean })?.userCancelled;
}
