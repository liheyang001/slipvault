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
  tags: string[];
  status?: 'pending' | 'done';
  warrantyMonths?: number; // 0 or undefined = no warranty
  warrantyNotifId?: string; // scheduled notification id
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
  tags?: string[];
}
