import { SearchFilters } from './invoice';

export type RootStackParamList = {
  Home: { filters?: SearchFilters } | undefined;
  Camera: undefined;
  Review: { photoUri: string; queue?: string[] };
  InvoiceDetail: { invoiceId: string };
  Search: { filters?: SearchFilters } | undefined;
  Rooms: undefined;
  Insurance: undefined;
  Paywall: undefined;
  Settings: undefined;
};
