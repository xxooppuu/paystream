export interface ZZResponse {
  respCode: string;
  errorMsg?: string;
  respData?: any;
}

export interface StoreAccount {
  id: string;
  remark: string;
  cookie: string;
  csrfToken?: string;
  lastUpdated?: string;
  status: 'active' | 'error' | 'loading';
  inventory?: InventoryItem[];
}

export interface BuyerAccount {
  id: string;
  remark: string;
  cookie: string;
  totalOrders: number;
  successOrders: number;
}

export interface InventoryItem {
  id: string;
  childOrderId: string;
  orderId?: string;
  infoId?: string;
  parentTitle: string;
  price: string;
  priceNum: number;
  picUrl: string;
  status: string;
  internalStatus?: 'idle' | 'occupied' | 'sold';
  accountId: string;
  accountRemark: string;
  lastMatchedTime?: number;
}

export interface Order {
  id: string; // Merchant Order ID
  orderNo: string; // System Order No
  customer: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  channel: string; // e.g. 'WeChat', 'Alipay'
  method: string; // e.g. 'Credit Card', 'Balance'
  createdAt: string;
  inventoryId?: string; // ID of the locked inventory item
  accountId?: string;   // ID of the seller account
  buyerId?: string;     // ID of the buyer account (for cancellation/viewing)
}

export enum OrderStatus {
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled'
}

export enum PaymentMethod {
  WECHAT = 'WeChat',
  ALIPAY = 'Alipay',
  CARD = 'Credit Card'
}

export interface SystemSettings {
  password?: string;
  // Add other settings here in the future
}

export interface PaymentPageConfig {
  id: string;
  title: string;
  channelId: string; // 'default' for now
  minAmount?: number;
  maxAmount?: number;
  notice?: string;
  createdAt: number;
}

export type ViewState = 'dashboard' | 'orders' | 'inventory' | 'test-payment' | 'config' | 'channels' | 'settings' | 'payment-pages';
