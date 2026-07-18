export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Invoice {
  id: string;
  photoUri: string;
  ocrText: string;
  vendor: string;
  date: string; // ISO date string
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  category: string;
  room?: string; // physical location, e.g. for insurance grouping
  itemPhotos?: string[]; // photos of the actual items (proof of ownership)
  brand?: string; // e.g. "Apple" — insurers ask for these on claims
  model?: string; // e.g. "MacBook Pro 14"
  serialNumber?: string;
  tags: string[];
  status?: 'pending' | 'done';
  warrantyMonths?: number; // 0 or undefined = no warranty
  warrantyNotifId?: string; // scheduled notification id
  note?: string; // free-form note (e.g. warranty/claim details)
  createdAt: string;
  updatedAt: string;
}

export type NewInvoice = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;

export interface SearchFilters {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: number;
  maxTotal?: number;
  category?: string;
  room?: string;
  tags?: string[];
}
