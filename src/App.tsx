import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ListOrdered,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Bell,
  Package,
  CreditCard
} from 'lucide-react';

import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { OrderCenter } from './components/OrderCenter';
import { PaymentChannels } from './components/PaymentChannels';
import { Inventory } from './components/Inventory';
import { TestPayment } from './components/TestPayment';
import { PaymentConfig } from './components/PaymentConfig';
import { Settings } from './components/Settings';
import { PaymentPages } from './components/PaymentPages';
import { PublicPayment } from './components/PublicPayment';
import { ViewState, Order, OrderStatus } from './types';
import { getApiUrl, PROXY_URL } from './config';

const App: React.FC = () => {
  // Check for Public Payment Route
  const [publicPayId, setPublicPayId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payId = params.get('pay');
    if (payId) setPublicPayId(payId);
  }, []);

  // Global State
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    // Check local storage for session
    const session = localStorage.getItem('auth_session');
    if (session) {
      try {
        const { expiry } = JSON.parse(session);
        if (Date.now() < expiry) return true;
      } catch (e) { /* ignore invalid json */ }
    }
    return false;
  });
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Default open on desktop
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [clockDrift, setClockDrift] = useState(0);

  // Fetch Orders from Local Storage
  const fetchOrders = async () => {
    try {
      const res = await fetch(getApiUrl('orders'));
      if (res.ok) {
        const savedOrders: Order[] = await res.json();
        if (savedOrders) {
          setOrders(savedOrders.reverse()); // Show newest first
        }
      }
    } catch (e) {
      console.error("Failed to fetch orders from proxy", e);
    }
  };

  // Also fetch on mount
  useEffect(() => {
    fetchOrders();
    fetch(getApiUrl('settings'))
      .then(res => res.json())
      .then(data => setSettings(data))
      .catch(console.error);

    fetch(getApiUrl('get_ip'))
      .then(res => res.json())
      .then(data => {
        if (data.serverTime) {
          setClockDrift(data.serverTime - Date.now());
        }
      })
      .catch(console.error);
  }, []);

  // Helper: Perform API Cancellation (Manual or Auto)
  const performOrderCancellation = async (order: Order): Promise<boolean> => {
    if (!order.buyerId) {
      console.warn(`Cannot cancel order ${order.id}: Missing buyerId (legacy order?)`);
      return false;
    }

    try {
      // 1. Get Buyer Cookie
      const bRes = await fetch(getApiUrl('buyers'));
      if (!bRes.ok) return false;
      const buyers: any[] = await bRes.json();
      const buyer = buyers.find((b: any) => b.id === order.buyerId);
      if (!buyer) {
        console.error(`Buyer ${order.buyerId} not found`);
        return false;
      }

      // 2. Call Cancel API (Proxy)
      // According to '取消订单.txt', POST to https://app.zhuanzhuan.com/zzx/transfer/cancelOrder
      // Body: cancelReason=不想要了&orderId=...

      const proxyRes = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: 'https://app.zhuanzhuan.com/zzx/transfer/cancelOrder',
          method: 'POST',
          cookie: buyer.cookie,
          body: `cancelReason=不想要了&subCancelReason=&orderId=${order.id}`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Referer': 'https://m.zhuanzhuan.com/'
          }
        })
      });

      const apiRes = await proxyRes.json();

      // Check success code (respCode: "0")
      if (apiRes.respCode === '0' || apiRes.respData?.statusInfo === '已取消') {
        console.log(`API Cancelled Order ${order.id} Successfully`);
        return true;
      } else {
        console.error(`API Cancel Failed for ${order.id}:`, apiRes);
        // If already cancelled or invalid, we might still want to mark local as cancelled if it looks terminal
        return false;
      }
    } catch (e) {
      console.error(`Exception cancelling order ${order.id}`, e);
      return false;
    }
  };

  // Helper: Release Inventory
  const releaseInventoryForOrder = async (order: Order) => {
    if (!order.inventoryId) return;

    const sRes = await fetch(getApiUrl('shops'));
    if (sRes.ok) {
      const shops: any[] = await sRes.json();
      let shopsChanged = false;

      const newShops = shops.map(shop => {
        if (shop.inventory) {
          const newInv = shop.inventory.map((item: any) => {
            if (item.id === order.inventoryId && item.internalStatus === 'occupied') {
              shopsChanged = true;
              return { ...item, internalStatus: 'idle', status: '在售(自动释放)' };
            }
            return item;
          });
          return { ...shop, inventory: newInv };
        }
        return shop;
      });

      if (shopsChanged) {
        await fetch(getApiUrl('shops'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newShops)
        });
        console.log('Released inventory for order:', order.id);
      }
    }
  };

  // Manual Cancellation Handler
  const handleCancelOrder = async (order: Order) => {
    if (!confirm('确定要取消此订单吗？')) return;

    const success = await performOrderCancellation(order);
    if (success) {
      // Update Order Status locally
      const updatedOrders = orders.map(o =>
        o.id === order.id ? { ...o, status: OrderStatus.CANCELLED } : o
      );
      setOrders(updatedOrders);

      // Persist Order
      await fetch(getApiUrl('orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedOrders) // Saving reversed list is risky if backend expects order? No, upsert is usually whole list in this app.
        // Logic in fetchOrders reverses it for View. Logic in save saves 'newOrders'.
        // We should probably save the RAW list. But 'orders' state is currently reversed view?
        // The fetchOrders: setOrders(savedOrders.reverse())
        // So 'orders' is reversed.
        // To save, we should un-reverse or just save as is because backend overwrites?
        // Actually TestPayment saves: [newOrder, ...otherOrders]. 
        // App saves: updatedOrders.
        // Let's rely on state.
      });

      // Release Inventory
      await releaseInventoryForOrder(order);
      alert('订单已取消');
    } else {
      alert('取消失败，可能是API调用错误或订单状态已变更');
    }
  };

  // Auto-Cancel Job (Check every 30s)
  useEffect(() => {
    const checkExpiredOrders = async () => {
      try {
        // 1. Fetch latest orders
        const oRes = await fetch(getApiUrl('orders'));
        if (!oRes.ok) return;
        const allOrders: Order[] = await oRes.json();

        const now = Date.now();
        let hasChanges = false;

        // We need to loop carefully since async awaits inside map/forEach are tricky
        const updatedOrders = [...allOrders];

        for (let i = 0; i < updatedOrders.length; i++) {
          const o = updatedOrders[i];
          if (o.status === OrderStatus.PENDING) {
            const createdTime = new Date(o.createdAt).getTime();
            const validitySec = settings?.validityDuration ? Number(settings.validityDuration) : 180;
            const now = Date.now() + clockDrift;
            if (now - createdTime > validitySec * 1000) { // Dynamic validity with sync time
              console.log(`Auto-cancelling expired order: ${o.id}`);

              // Attempt API Cancel
              // Even if API fails (e.g. legacy order), we might force cancel local status?
              // User said: "send request... then order status becomes cancelled"
              // If request fails, maybe we shouldn't cancel local? 
              // But for legacy orders without buyerId, they will be stuck forever.
              // Let's try API, if fails but it's legacy (no buyerId), force cancel local.
              // If it has buyerId but fails, maybe network issue, retry next time?

              let cancelled = false;
              if (o.buyerId) {
                cancelled = await performOrderCancellation(o);
              } else {
                // Legacy: just force cancel
                cancelled = true;
              }

              if (cancelled) {
                updatedOrders[i] = { ...o, status: OrderStatus.CANCELLED };
                hasChanges = true;

                // Release Inventory
                await releaseInventoryForOrder(o);
              }
            }
          }
        }

        if (!hasChanges) return;

        // 3. Save updated orders
        await fetch(getApiUrl('orders'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedOrders)
        });

        // Update local state if we are viewing orders
        if (currentView === 'orders' || currentView === 'dashboard') {
          setOrders(updatedOrders.reverse());
        }

      } catch (e) {
        console.error("Auto-cancel job failed", e);
      }
    };

    const interval = setInterval(checkExpiredOrders, 10000); // 10s for timely release
    return () => clearInterval(interval);
  }, [currentView]);

  // Manual Status Check Handler
  const handleCheckOrderStatus = async (order: Order, silent: boolean = false) => {
    if (!order.buyerId) {
      if (!silent) alert('无法查询：该订单缺少买家信息 (旧订单)');
      return;
    }

    try {
      // 1. Get Buyer Cookie
      const bRes = await fetch(getApiUrl('buyers'));
      const buyers: any[] = await bRes.json();
      const buyer = buyers.find((b: any) => b.id === order.buyerId);
      if (!buyer) {
        if (!silent) alert('未找到买家账号');
        return;
      }

      // 2. Call GetOrder API
      // https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=...&abGroup=2
      const targetUrl = `https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=${order.id}&abGroup=2`;

      const proxyRes = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl,
          method: 'GET',
          cookie: buyer.cookie,
          headers: { 'Referer': 'https://m.zhuanzhuan.com/' }
        })
      });

      const res = await proxyRes.json();

      if (res.respCode === '0') {
        const statusStr = res.respData?.status;
        const statusInfo = res.respData?.statusInfo;

        let newStatus = order.status;
        let msg = `当前状态: ${statusInfo} (Code: ${statusStr})`;

        if (statusStr === '3' || statusInfo?.includes('待发货') || statusInfo?.includes('已支付')) {
          newStatus = OrderStatus.SUCCESS;
          msg += ' -> 更新为: 已支付';
        } else if (statusStr === '19' || statusInfo?.includes('已取消')) {
          newStatus = OrderStatus.CANCELLED;
          msg += ' -> 更新为: 已取消';
        } else if (statusStr === '17' || statusInfo?.includes('退款完成')) {
          newStatus = OrderStatus.REFUNDED;
          msg += ' -> 更新为: 已退款';
        } else if (statusStr === '1') {
          msg += ' (未支付)';
        }

        if (newStatus !== order.status) {
          // Update Logic
          const updatedOrders = orders.map(o => o.id === order.id ? { ...o, status: newStatus } : o);
          setOrders(updatedOrders);
          await fetch(getApiUrl('orders'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedOrders)
          });

          // Release Inventory (Set to Idle) for ANY terminal state
          if (newStatus === OrderStatus.SUCCESS || newStatus === OrderStatus.CANCELLED || newStatus === OrderStatus.REFUNDED) {
            await releaseInventoryForOrder(order);
          }
          if (!silent) alert(msg);
        } else {
          // Status matched, no update needed, but query was successful
          if (!silent) alert(`查询成功: 订单状态正常。\n当前状态: ${statusInfo || '未知'} (Code: ${statusStr})`);
        }
      } // Close if respCode === '0'
    } catch (e: any) {
      if (!silent) alert(`请求异常: ${e.message}`);
    }
  };

  // Auto-Cancel Job (Check every 30s)
  // ...

  // Refetch whenever view changes to 'orders' or 'dashboard' to ensure fresh data
  useEffect(() => {
    if (currentView === 'orders' || currentView === 'dashboard') {
      fetchOrders();
    }
  }, [currentView]);

  // Responsive handling
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setIsSidebarOpen(false);
      else setIsSidebarOpen(true);
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Init
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check Backend Version / Availability
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch(getApiUrl('orders'));
        if (!res.ok) {
          console.warn('Backend seemingly unavailable');
        }
      } catch (e) {
        console.error("Backend check failed", e);
      }
    };
    checkBackend();
  }, []);

  // NEW: Auto-Poll Status for Pending Orders (Every 5s)
  useEffect(() => {
    if (!orders || orders.length === 0) return;

    const interval = setInterval(() => {
      // Filter orders: PENDING and created within last 10 mins (600000ms)
      const now = Date.now();
      const tenMinsAgo = now - 10 * 60 * 1000;

      const activePendingOrders = orders.filter(o => {
        if (o.status !== OrderStatus.PENDING) return false;
        const createdTime = new Date(o.createdAt).getTime();
        return createdTime > tenMinsAgo;
      });

      if (activePendingOrders.length > 0) {
        console.log(`Auto-polling ${activePendingOrders.length} pending orders...`);
        // Check each one silently (no alert on success)
        activePendingOrders.forEach(o => {
          handleCheckOrderStatus(o, true);
        });
      }
    }, 5000); // Check every 5s

    return () => clearInterval(interval);
  }, [orders]);

  // NEW: Auto-Poll Status for Pending Orders (Every 5s)
  useEffect(() => {
    if (!orders || orders.length === 0) return;

    const interval = setInterval(() => {
      // Filter orders: PENDING and created within last 10 mins (600000ms)
      const now = Date.now();
      const tenMinsAgo = now - 10 * 60 * 1000;

      const activePendingOrders = orders.filter(o => {
        if (o.status !== OrderStatus.PENDING) return false;
        const createdTime = new Date(o.createdAt).getTime();
        return createdTime > tenMinsAgo;
      });

      if (activePendingOrders.length > 0) {
        console.log(`Auto-polling ${activePendingOrders.length} pending orders...`);
        // Check each one silently (no alert on success)
        activePendingOrders.forEach(o => {
          // Need a silent version of handleCheckOrderStatus
          // For now, let's reuse handleCheckOrderStatus but we need to modify it to suppress alerts if auto-called?
          // Or extract the logic. 
          // Better: update handleCheckOrderStatus to accept a 'silent' flag.
          handleCheckOrderStatus(o, true);
        });
      }
    }, 5000); // Check every 5s

    return () => clearInterval(interval);
  }, [orders]);

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('auth_session');
    setCurrentView('dashboard');
  };

  if (publicPayId) {
    return <PublicPayment pageId={publicPayId} />;
  }

  if (!isLoggedIn) {
    return <Login onLogin={() => {
      setIsLoggedIn(true);
      // Save session (24h)
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('auth_session', JSON.stringify({ expiry }));
    }} />;
  }

  // Navigation Items
  const navItems = [
    { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { id: 'orders', label: '订单中心', icon: ListOrdered },
    { id: 'inventory', label: '商品库存', icon: Package },
    { id: 'test-payment', label: '测试支付', icon: CreditCard },
    { id: 'config', label: '通道配置', icon: SettingsIcon },
    { id: 'settings', label: '系统设置', icon: SettingsIcon },
    { id: 'payment-pages', label: '收款页管理', icon: CreditCard },
  ];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-800">

      {/* Sidebar Overlay for Mobile */}
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-64 bg-slate-900 text-white transform transition-transform duration-200 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:hidden'}
          flex flex-col
        `}
      >
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
              <span className="font-bold text-white">P</span>
            </div>
            <span className="text-lg font-bold tracking-tight">PayStream</span>
          </div>
          {isMobile && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="ml-auto text-slate-400"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentView(item.id as ViewState);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                className={`
                            w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors
                            ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
                        `}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden w-full">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 focus:outline-none lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>

          <div className="flex items-center space-x-4">
            <button className="relative p-2 rounded-full hover:bg-slate-100 text-slate-600 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold border border-indigo-200">
              A
            </div>
          </div>
        </header>

        {/* Scrollable Area */}
        <main className="flex-1 overflow-auto p-4 lg:p-8 relative">
          <div className="max-w-7xl mx-auto">
            {currentView === 'dashboard' && <Dashboard orders={orders} />}
            {currentView === 'orders' && <OrderCenter orders={orders} onCancelOrder={handleCancelOrder} onCheckStatus={handleCheckOrderStatus} />}
            {currentView === 'inventory' && <Inventory />}
            {currentView === 'test-payment' && <TestPayment />}
            {currentView === 'config' && <PaymentConfig />}
            {currentView === 'channels' && <PaymentChannels />}
            {currentView === 'settings' && <Settings />}
            {currentView === 'payment-pages' && <PaymentPages />}
          </div>
          {/* Version Footer */}
          <div className="fixed bottom-4 right-4 text-xs text-slate-400 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-200">
            Admin v1.6.9 (Bug Fix Release)
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
