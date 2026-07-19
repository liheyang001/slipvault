import { SearchFilters } from './invoice';

export type RootStackParamList = {
  Home: { filters?: SearchFilters } | undefined;
  Camera: { defaultRoom?: string } | undefined;
  Review: { photoUri: string; queue?: string[]; defaultRoom?: string };
  ManualEntry: { defaultRoom?: string } | undefined;
  InvoiceDetail: { invoiceId: string };
  Search: { filters?: SearchFilters } | undefined;
  Paywall: undefined;
  Settings: undefined;
};
