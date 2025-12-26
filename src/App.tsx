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
import { getApiUrl, PROXY_URL, APP_VERSION } from './config';
import { SetupWizard } from './components/SetupWizard';
const App: React.FC = () => {
  document.title = 'PayStream Admin v2.2.99 (FIXED)';

  // Check for Public Payment Route
  const [publicPayId, setPublicPayId] = useState<string | null>(null);
  const [isSecretPath, setIsSecretPath] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payId = params.get('pay');
    if (payId) {
      setPublicPayId(payId);
    }

    // Security: Only allow admin access on specific path
    // Localhost exception for development ease
    // v2.2.96: Support Hash-based access (#chen363700) to bypass Nginx 404 issues without server config
    const isSecretHash = window.location.hash.includes('chen363700');
    const isSecretPath = window.location.pathname.includes('/chen363700');

    if (isSecretPath || isSecretHash || window.location.hostname === 'localhost') {
      setIsSecretPath(true);
    }

    // v2.2.96: Force Unregister Legacy Service Workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (let registration of registrations) {
          console.log('Unregistering SW:', registration);
          registration.unregister();
        }
      });
    }
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
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

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
  // v2.2.96 Check Installation Status & Fetch Initial Data
  useEffect(() => {
    const checkUrl = getApiUrl('check_setup') + '&_t=' + new Date().getTime();
    fetch(checkUrl)
      .then(async (res) => {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          // DEBUG v2.2.96: Only show if NOT on public payment page
          const params = new URLSearchParams(window.location.search);
          if (!params.get('pay')) {
            alert(`[DEBUG v2.2.96]\nStatus: ${data.status}`);
          }
          if (data.status === 'needs_setup' || data.installed === false) {
            setNeedsSetup(true);
          } else {
            // Only fetch orders if system is installed
            fetchOrders();
          }
          setIsCheckingSetup(false);
        } catch (e) {
          // CRITICAL DEBUG
          console.error("Server Response Not JSON:", text);
          alert(`[CRITICAL ERROR v2.2.96]\nServer returned non-JSON data!\n\n${text.substring(0, 500)}`);
          setIsCheckingSetup(false);
        }
      })
      .catch((err) => {
        alert(`[Network Error v2.2.96]\n${err.message}`);
        setIsCheckingSetup(false);
      });

    fetch(getApiUrl('settings'))
      .then(res => res.json())
      .then(data => {
        if (data.status === 'needs_setup') {
          setNeedsSetup(true);
          return;
        }
        setSettings(data);
      })
      .catch(console.error);

    fetch(getApiUrl('get_ip'))
      .then(res => res.json())
      .then(data => {
        if (data.status === 'needs_setup') {
          setNeedsSetup(true);
          setIsCheckingSetup(false);
          return;
        }
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
      // Alignment v2.2.96: Use zzx domain and URLSearchParams for correct encoding
      const cancelParams = new URLSearchParams();
      cancelParams.append('cancelReason', '不想要了');
      cancelParams.append('subCancelReason', '');
      cancelParams.append('orderId', order.orderNo);

      const proxyRes = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: 'https://app.zhuanzhuan.com/zzx/transfer/cancelOrder',
          method: 'POST',
          cookie: buyer.cookie,
          body: cancelParams.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Referer': 'https://m.zhuanzhuan.com/',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 zzVersion/11.21.5 zzT/16 zzDevice/1_141.0_3.0 zzApp/58ZhuanZhuan'
          }
        })
      });

      const apiRes = await proxyRes.json();

      // Check success code (respCode: "0")
      if (apiRes.respCode === '0' || apiRes.respData?.statusInfo === '已取消') {
        console.log(`API Cancelled Order ${order.orderNo} Successfully`);
        return true;
      } else {
        console.error(`API Cancel Failed for ${order.orderNo}:`, apiRes);
        // If already cancelled or invalid, we might still want to mark local as cancelled if it looks terminal
        return false;
      }
    } catch (e) {
      console.error(`Exception cancelling order ${order.orderNo}`, e);
      return false;
    }
  };

  // Helper: Release Inventory (Atomic Server-Side)
  const releaseInventoryForOrder = async (order: Order) => {
    if (!order.inventoryId) return;

    try {
      // v2.2.96: Use the dedicated atomic release endpoint instead of manual file patching
      const res = await fetch(getApiUrl('release_inventory'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.inventoryId,
          accountId: order.accountId
        })
      });

      if (res.ok) {
        console.log('Atomically released inventory for order:', order.id);
      } else {
        const errData = await res.json();
        console.error('Atomic release failed:', errData.error);
      }
    } catch (e) {
      console.error('Error calling release_inventory API:', e);
    }
  };

  const handleCancelOrder = async (order: Order) => {
    if (!confirm('确定要取消此订单吗？')) return;

    let success = true;
    if (order.status !== OrderStatus.QUEUEING) {
      success = await performOrderCancellation(order);
    }

    if (success) {
      // v2.2.96: Simply call server-side atomic cancellation
      // The server will handle status update AND inventory release in one transaction
      const cancelRes = await fetch(getApiUrl('cancel_order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id })
      });

      if (cancelRes.ok) {
        // Update local state for immediate feedback
        const updatedOrders = orders.map(o =>
          o.id === order.id ? { ...o, status: OrderStatus.CANCELLED } : o
        );
        setOrders(updatedOrders);
        alert('订单已取消并释放库存');
      } else {
        const err = await cancelRes.json();
        alert('本地取消失败: ' + (err.error || '未知错误'));
      }
    } else {
      if (confirm('API取消失败（账号可能掉线或订单已失效）。\n\n是否执行“强制本地取消”？这会强行标记订单为已取消并释放库存。')) {
        const cancelRes = await fetch(getApiUrl('cancel_order'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id })
        });

        if (cancelRes.ok) {
          const updatedOrders = orders.map(o =>
            o.id === order.id ? { ...o, status: OrderStatus.CANCELLED } : o
          );
          setOrders(updatedOrders);
          alert('订单已强制执行本地取消');
        } else {
          alert('强制取消失败，请重试');
        }
      }
    }
  };

  // Auto-Cancel Job (Check every 30s)
  useEffect(() => {
    const checkExpiredOrders = async () => {
      try {
        // 0. Fetch latest settings (to ensure validityDuration is up to date)
        const sRes = await fetch(getApiUrl('settings'));
        const latestSettings = sRes.ok ? await sRes.json() : settings;

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
            // v2.2.96: Use solid Unix Milliseconds instead of timezone-shaky date strings
            const createdTime = o.createdAtMs ? Number(o.createdAtMs) : new Date(o.createdAt).getTime();
            const validitySec = latestSettings?.validityDuration ? Number(latestSettings.validityDuration) : 180;
            const now = Date.now() + clockDrift;
            if (now - createdTime > validitySec * 1000) {
              console.log(`Auto-cancelling expired order: ${o.id} (Created: ${createdTime}, Now: ${now}, Diff: ${now - createdTime}ms)`);

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
                // v2.2.96: Server-side cancel_order already handles inventory release.
                // Removing frontend release call to prevent "Release Storms" and race conditions.
              } else {
                // v2.2.96: Hard Expiry - if it's been double the validity duration and still pending, force it.
                const hardExpirySec = validitySec * 2;
                if (now - createdTime > hardExpirySec * 1000) {
                  console.log(`Hard-cancelling stuck order: ${o.id}`);
                  updatedOrders[i] = { ...o, status: OrderStatus.CANCELLED };
                  hasChanges = true;
                  // v2.2.96 Removed
                }
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
      const targetUrl = `https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=${order.orderNo}&abGroup=2`;

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

  // v2.2.96: Consolidated Auto-Poll Status for Pending Orders (Every 8s)
  useEffect(() => {
    if (!orders || orders.length === 0 || currentView !== 'orders') return;

    const interval = setInterval(() => {
      // Filter orders: PENDING and created within last 45 mins
      const now = Date.now() + clockDrift;
      const fortyFiveMinsAgo = now - 45 * 60 * 1000;

      const activePendingOrders = orders.filter(o => {
        if (o.status !== OrderStatus.PENDING) return false;
        const createdTime = new Date(o.createdAt).getTime();
        return createdTime > fortyFiveMinsAgo;
      });

      if (activePendingOrders.length > 0) {
        console.log(`Auto-polling ${activePendingOrders.length} pending orders...`);
        // Check each one silently
        activePendingOrders.forEach(o => {
          handleCheckOrderStatus(o, true);
        });
      }
    }, 8000); // 8s for efficiency

    return () => clearInterval(interval);
  }, [orders, currentView, clockDrift]);

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('auth_session');
    setCurrentView('dashboard');
  };

  if (publicPayId) {
    return <PublicPayment pageId={publicPayId} />;
  }

  // Security: Block access if not on secret path
  if (!isSecretPath) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center selection:bg-none">
        <h1 className="text-gray-300 font-bold text-6xl tracking-widest select-none">404</h1>
      </div>
    );
  }

  if (isCheckingSetup) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-center text-gray-500 text-xs mt-8">Admin v2.2.99-MySQL &copy; 2025 PayStream. All rights reserved.</p>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <SetupWizard onComplete={() => setNeedsSetup(false)} />;
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
            Admin {APP_VERSION}-MySQL
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
