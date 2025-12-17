import { Order, OrderStatus, PaymentMethod } from './types';

// Helper to generate mock orders
export const generateMockOrders = (count: number): Order[] => {
  const orders: Order[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const date = new Date(now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30)); // Last 30 days
    const isToday = date.toDateString() === now.toDateString();
    
    // Weighted status generation
    const rand = Math.random();
    let status = OrderStatus.SUCCESS;
    if (rand > 0.85) status = OrderStatus.FAILED;
    else if (rand > 0.75) status = OrderStatus.PENDING;

    // Random method
    const methods = Object.values(PaymentMethod);
    const method = methods[Math.floor(Math.random() * methods.length)];

    orders.push({
      id: `ord_${Math.random().toString(36).substr(2, 9)}`,
      orderNo: `PO${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
      amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
      currency: 'USD',
      status,
      method,
      createdAt: date.toISOString(),
      customerName: `User ${Math.floor(Math.random() * 1000)}`,
    });
  }
  
  // Sort by date desc
  return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const MOCK_ORDERS = generateMockOrders(350);
