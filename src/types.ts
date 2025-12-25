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
  csrfToken?: string;
  totalOrders: number;
  successOrders: number;
  addressId?: string;
  addressName?: string;
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
  internalStatus: 'idle' | 'occupied' | 'sold';
  autoReleaseTime?: number; // timestamp
  lastMatchedTime?: number; // timestamp
  lockTicket?: string | null; // v2.2.68: For CAS Protection
  accountId: string;
  accountRemark: string;
}

export interface Order {
  id: string; // Merchant Order ID
  shortId?: string; // Short System ID for display
  orderNo: string; // System Order No
  customer: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  channel: string; // e.g. 'WeChat', 'Alipay'
  method: string; // e.g. 'Credit Card', 'Balance'
  createdAt: string;
  createdAtMs?: number; // v2.2.56: Unix timestamp for reliable expiration check
  inventoryId?: string; // ID of the locked inventory item
  accountId?: string;   // ID of the seller account
  buyerId?: string;     // ID of the buyer account (for cancellation/viewing)
}

export enum OrderStatus {
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
  QUEUEING = 'queueing'
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
  isOpen?: boolean;
  ipLimitTime?: number; // In hours
  ipLimitCount?: number;
  ipWhitelist?: string; // Comma-separated
}

export type ViewState = 'dashboard' | 'orders' | 'inventory' | 'test-payment' | 'config' | 'channels' | 'settings' | 'payment-pages';
