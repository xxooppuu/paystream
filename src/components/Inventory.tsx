import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus,
    Trash2,
    RefreshCw,
    Store,
    AlertCircle,
    Package,
    ExternalLink,
    X,
    AlertTriangle,
    Key,
    Server,
    Filter,
    Edit2,
    Save,
    Unlock
} from 'lucide-react';
import { StoreAccount, InventoryItem, ZZResponse, Order, OrderStatus } from '../types';
import { getApiUrl, PROXY_URL } from '../config';
import { performOrderCancellation, releaseInventory } from '../utils/orderActions';

export const Inventory: React.FC = () => {

    // State
    const [accounts, setAccounts] = useState<StoreAccount[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [proxyError, setProxyError] = useState(false);

    // Filters
    const [filterStore, setFilterStore] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');

    // Price Edit State
    const [editItem, setEditItem] = useState<InventoryItem | null>(null);
    const [newPrice, setNewPrice] = useState('');
    const [priceError, setPriceError] = useState<string | null>(null);
    const [isSubmittingPrice, setIsSubmittingPrice] = useState(false);

    // Form State
    const [newRemark, setNewRemark] = useState('');
    const [newCookie, setNewCookie] = useState('');
    const [newCsrfToken, setNewCsrfToken] = useState('');

    const fetchShopsData = useCallback(() => {
        fetch(getApiUrl('shops'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const fixedData = data.map((a: StoreAccount) => ({ ...a, inventory: a.inventory || [] }));
                    setAccounts(fixedData);
                    const allItems = fixedData.flatMap((a: StoreAccount) => a.inventory || []);
                    setInventory(allItems);
                }
            })
            .catch(err => console.error('Failed to load shops', err));
    }, []);

    useEffect(() => {
        // v2.2.51: Restore initial local fetch (fast)
        fetchShopsData();

        // v2.2.22: Listen for global refresh events from utilities
        const handleForceRefresh = () => {
            console.log('[Event] Inventory refresh triggered');
            fetchShopsData();
        };
        window.addEventListener('refresh-inventory', handleForceRefresh);
        return () => window.removeEventListener('refresh-inventory', handleForceRefresh);
    }, [fetchShopsData]);

    const saveShopsToBackend = async (newAccounts: StoreAccount[], newInventory: InventoryItem[]) => {
        // Attach inventory to accounts for persistence
        const accountsWithData = newAccounts.map(account => ({
            ...account,
            inventory: newInventory.filter(i => i.accountId === account.id)
        }));

        try {
            await fetch(getApiUrl('shops'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(accountsWithData)
            });
        } catch (err) {
            console.error('Failed to save shops', err);
        }
    };

    /**
     * Helper: Proxy Request Wrapper
     */
    const proxyRequest = async (targetUrl: string, account: StoreAccount) => {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: targetUrl,
                cookie: account.cookie,
                csrfToken: account.csrfToken
            })
        });
        if (!response.ok) throw new Error(`Proxy status: ${response.status}`);
        return await response.json();
    };

    /**
     * Deep Fetch: Get List -> Get Details for each -> Merge
     */
    const fetchDeepAccountData = async (account: StoreAccount): Promise<InventoryItem[]> => {
        const listUrl = 'https://app.zhuanzhuan.com/zzx/transfer/getSellerOrders2?pageNum=1&pageSize=20&tipId=2&keyWords=&abGroup=2';

        const listData = await proxyRequest(listUrl, account);
        if (listData.respCode !== '0') {
            throw new Error(`API Error: ${listData.respCode} ${listData.errorMsg || ''}`);
        }

        const orderList = listData.respData?.orderList || [];
        const items: InventoryItem[] = [];

        for (const order of orderList) {
            const parentTitle = order.infoTitle || '未知商品';

            if (order.childOrderList && order.childOrderList.length > 0) {
                for (const child of order.childOrderList) {
                    // v2.2.98: Filter - ONLY grab "出售中" and "买家已拍下" items.
                    const allowedStatuses = ['出售中', '买家已拍下'];
                    if (!allowedStatuses.includes(child.statusTip)) {
                        continue;
                    }

                    // Fetch Details for InfoID
                    const detailUrl = `https://app.zhuanzhuan.com/zzopen/c2b_consignment/getOrderShareInfo?recycleOrderId=${child.childOrderId}`;

                    let infoId = 'Loading...';
                    try {
                        const detailData = await proxyRequest(detailUrl, account);
                        // Parse infoId from detailData...
                        if (detailData.respData?.shareProductInfo?.jumpUrl) {
                            const match = detailData.respData.shareProductInfo.jumpUrl.match(/infoId=(\d+)/);
                            if (match) infoId = match[1];
                        }
                    } catch (e) {
                        console.warn('Failed to fetch details for', child.childOrderId);
                    }

                    items.push({
                        id: child.childOrderId,
                        childOrderId: child.childOrderId,
                        orderId: order.orderId, // Parent Order ID
                        infoId: infoId,
                        parentTitle: parentTitle,
                        picUrl: child.pics,
                        price: child.price,
                        priceNum: parseFloat(child.priceNum || child.price.replace(/,/g, '')) || 0, // Fallback parsing
                        status: child.statusTip,
                        internalStatus: 'idle',
                        accountId: account.id,
                        accountRemark: account.remark
                    });
                }
            }
        }
        return items;
    };

    // v2.2.51: Removed auto-sync loop to prevent "Inventory Wipeout" and performance lag.
    // Data is only synced with Zhuanzhuan when the "Refresh" button is manually clicked.

    /**
     * Refresh Data Only (Preserves Occupied Status & Images)
     * silent: if true, don't show global loading state (optional)
     */
    const handleRefreshData = async (forceUpdateImages = false) => {
        setIsLoading(true);
        setLastError(null);
        setProxyError(false);
        const startAccounts = [...accounts];

        // Mark accounts as loading
        setAccounts(prev => prev.map(a => ({ ...a, status: 'loading' as const })));

        let allNewItems: InventoryItem[] = [];

        // Execute in parallel
        const promises = startAccounts.map(async (account) => {
            try {
                const fetchedItems = await fetchDeepAccountData(account);
                return { success: true, id: account.id, items: fetchedItems };
            } catch (error: any) {
                console.error(`Failed to refresh ${account.remark}`, error);
                return { success: false, id: account.id, error: error.message };
            }
        });

        const results = await Promise.all(promises);

        const finalAccounts = startAccounts.map(account => {
            const res = results.find(r => r.id === account.id);
            if (res?.success && res.items) {
                // MERGE LOGIC: Combine fetched items with existing state
                // We need to look up against the LAST known inventory state
                const newItemsForAccount = res.items.map(newItem => {
                    const oldItem = inventory.find(old => old.id === newItem.id);

                    return {
                        ...newItem,
                        // 1. Preserve Internal Status (Occupied/Sold)
                        internalStatus: oldItem?.internalStatus || 'idle',
                        // 2. Preserve Image if exists and not forced to update
                        picUrl: (!forceUpdateImages && oldItem?.picUrl) ? oldItem.picUrl : newItem.picUrl,
                        // Preserve other local fields if needed
                    };
                });

                allNewItems.push(...newItemsForAccount);
                return { ...account, status: 'active' as const, lastUpdated: new Date().toLocaleTimeString() };
            } else {
                // Keep old items if fail
                const oldItems = inventory.filter(i => i.accountId === account.id);
                allNewItems.push(...oldItems);

                if (res?.error?.includes('Failed to fetch')) setProxyError(true);
                return { ...account, status: 'error' as const };
            }
        });

        setInventory(allNewItems);
        setAccounts(finalAccounts);
        saveShopsToBackend(finalAccounts, allNewItems);
        setIsLoading(false);
    };

    /**
     * Release All Locks
     */
    const handleReleaseAll = async () => {
        if (!confirm('确定要释放所有被占用的商品吗？这将会自动取消所有关联的未支付订单！')) return;

        setIsLoading(true);
        try {
            // 1. Fetch current orders to find which ones are locking these items
            const oRes = await fetch(getApiUrl('orders'));
            let pendingOrders: Order[] = [];
            if (oRes.ok) {
                const allOrders: Order[] = await oRes.json();
                pendingOrders = allOrders.filter(o => o.status === OrderStatus.PENDING && o.inventoryId);
            }

            const occupiedItems = inventory.filter(i => i.internalStatus === 'occupied');
            let cancelCount = 0;

            // 2. Cancel associated orders
            for (const item of occupiedItems) {
                const order = pendingOrders.find(o => o.inventoryId === item.id);
                if (order && order.buyerId) {
                    await performOrderCancellation(order.id, order.buyerId);

                    // Update order status locally and on backend
                    // Note: We are not updating the full order list here efficiently, but let's do a quick update?
                    // actually performOrderCancellation only calls API. we should update order release?
                    // The App.tsx loop will eventually sync it, but better to mark it cancelled now if possible.
                    // For now, API cancellation is the critical part requested.
                    cancelCount++;
                }
            }

            // 3. Release Inventory locally and remote
            const releasedInventory = inventory.map(item => ({
                ...item,
                internalStatus: item.internalStatus === 'occupied' ? 'idle' : item.internalStatus,
                lastMatchedTime: undefined
            } as InventoryItem));
            setInventory(releasedInventory);

            for (const item of occupiedItems) {
                await releaseInventory(item.id, item.accountId);
            }

            alert(`✅ 成功释放 ${occupiedItems.length} 个商品，并取消了 ${cancelCount} 个关联订单！`);
            // v2.2.20: Force refresh from backend to ensure state sync
            if (typeof (window as any).refreshShops === 'function') {
                (window as any).refreshShops();
            }
        } catch (e) {
            console.error(e);
            alert('释放过程中发生错误');
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Manual Release Single Item
     */
    const handleManualRelease = async (item: InventoryItem) => {
        if (!confirm('确定要释放此商品吗？如果有关联订单将被取消。')) return;

        // Try to find and cancel order
        try {
            const oRes = await fetch(getApiUrl('orders'));
            if (oRes.ok) {
                const allOrders: Order[] = await oRes.json();
                const order = allOrders.find(o => o.status === OrderStatus.PENDING && o.inventoryId === item.id);
                if (order && order.buyerId) {
                    await performOrderCancellation(order.id, order.buyerId);
                    // alert('关联订单已取消'); // Optional feedback
                }
            }
        } catch (e) {
            console.error("Error cancelling order during release", e);
        }

        const updatedInventory = inventory.map(i =>
            i.id === item.id ? { ...i, internalStatus: 'idle' as const, status: '在售(手动释放)' } : i
        );
        setInventory(updatedInventory);

        // v2.1.4: Use Atomic Release via Utility
        // v2.2.68: Pass lockTicket for CAS protection to prevent releasing re-locked items
        try {
            await releaseInventory(item.id, item.accountId, item.lockTicket);
        } catch (e: any) {
            alert(`释放失败: ${e.message}`);
            // Revert local optimistic update if failed
            handleRefreshItem(item); // Refresh to show true state
            return;
        }

        // v2.2.20: Force refresh from backend to ensure state sync
        // v2.2.22: Dispatch global event instead of calling window.refreshShops
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
    };

    /**
     * Refresh Single Item
     * (Actually refreshes whole account logic because API is list-based or expensive detailed)
     * Optimization: We could just fetch the detail URL for this item?
     * `fetchDeepAccountData` does list + details. 
     * Let's reuse `fetchDeepAccountData` for the single account of this item, but filter to just update this item?
     * Or simpler: just trigger refresh for that whole account.
     */
    const handleRefreshItem = async (item: InventoryItem) => {
        const account = accounts.find(a => a.id === item.accountId);
        if (!account) return;

        // Visual feedback
        const tempInventory = inventory.map(i => i.id === item.id ? { ...i, status: '更新中...' } : i);
        setInventory(tempInventory);

        try {
            // We fetch the WHOLE account to be safe, but only merge this item?
            // Or just replace all items for this account? replacing is better to keep sync.
            const fetchedItems = await fetchDeepAccountData(account);

            // v2.2.98: Full replacement logic for the account to ensure stale items are cleared
            const updatedInventory = [
                ...inventory.filter(i => i.accountId !== account.id),
                ...fetchedItems.map(fresh => {
                    const existing = inventory.find(e => e.id === fresh.id);
                    return {
                        ...fresh,
                        internalStatus: existing?.internalStatus || 'idle',
                        picUrl: existing?.picUrl || fresh.picUrl
                    };
                })
            ];

            setInventory(updatedInventory);
            saveShopsToBackend(accounts, updatedInventory);
            alert(`商品 ${item.infoId} 数据已更新`);

        } catch (e: any) {
            alert(`更新失败: ${e.message}`);
            // Revert status
            setInventory(inventory);
        }
    };

    /**
     * Price Editing
     */
    const openEditPrice = (item: InventoryItem) => {
        setEditItem(item);
        setNewPrice(item.price); // String "5938.00"
        setPriceError(null);
    };

    const handlePriceSubmit = async () => {
        if (!editItem || !newPrice) return;

        const priceVal = parseFloat(newPrice);
        if (isNaN(priceVal)) {
            setPriceError('请输入有效数字');
            return;
        }

        const priceStr = Math.floor(priceVal).toString();
        if (!priceStr.endsWith('8')) {
            setPriceError('价格必须以 8 结尾 (如 398, 108)');
            return;
        }

        setIsSubmittingPrice(true);

        const account = accounts.find(a => a.id === editItem.accountId);
        if (!account) {
            setPriceError('找不到店铺账号');
            setIsSubmittingPrice(false);
            return;
        }

        const cents = Math.round(priceVal * 100);

        const targetUrl = `https://app.zhuanzhuan.com/zzopen/c2b_consignment/changePrice?argueSwitch=true&buyPrice=0&orderId=${editItem.childOrderId}&infoPrice=${cents}&infoShowPrice=${cents}&selectedFastWithdrawService=0`;

        try {
            const res = await proxyRequest(targetUrl, account);
            if (res.respCode === '0' || res.respData?.optResult === true) {
                // Success
                const updatedInventory = inventory.map(i => i.id === editItem.id ? { ...i, price: Number(priceVal).toFixed(2) } : i);
                setInventory(updatedInventory);
                saveShopsToBackend(accounts, updatedInventory);

                setEditItem(null);
                setNewPrice('');
            } else {
                setPriceError(res.errorMsg || '修改失败');
            }
        } catch (e: any) {
            setPriceError(e.message || '网络请求失败');
        }
        setIsSubmittingPrice(false);
    };

    const handleAddAccount = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRemark || !newCookie) return;

        const cleanedCookie = newCookie.replace(/(\r\n|\n|\r)/gm, "").trim();
        const cleanedToken = newCsrfToken.trim();

        const newAccount: StoreAccount = {
            id: Date.now().toString(),
            remark: newRemark,
            cookie: cleanedCookie,
            csrfToken: cleanedToken,
            status: 'active', // Default active
            inventory: []
        };

        const updatedAccounts = [...accounts, newAccount];
        setAccounts(updatedAccounts);
        saveShopsToBackend(updatedAccounts, inventory);

        setNewRemark('');
        setNewCookie('');
        setNewCsrfToken('');
        setIsModalOpen(false);
    };

    const removeAccount = (id: string) => {
        const updatedAccounts = accounts.filter(a => a.id !== id);
        const updatedInventory = inventory.filter(i => i.accountId !== id);
        setAccounts(updatedAccounts);
        setInventory(updatedInventory);
        saveShopsToBackend(updatedAccounts, updatedInventory);
    };

    // Filter Logic
    const filteredInventory = inventory.filter(item => {
        if (filterStore !== 'all' && item.accountId !== filterStore) return false;
        if (filterStatus !== 'all') {
            if (filterStatus === 'sold' && !item.status.includes('已售')) return false;
            if (filterStatus === 'active' && !item.status.includes('出售') && !item.status.includes('在售')) return false;
        }
        return true;
    });

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">商品库存管理</h2>
                    <p className="text-slate-500 text-sm">本地缓存模式 (点击刷新获取最新)</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReleaseAll}
                        className="flex items-center space-x-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors shadow-sm"
                    >
                        <Unlock className="w-4 h-4" />
                        <span>释放所有占用</span>
                    </button>
                    <button
                        onClick={() => handleRefreshData(true)}
                        disabled={isLoading}
                        className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        <span>{isLoading ? '正在同步...' : '刷新数据'}</span>
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        <span>添加店铺账号</span>
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Filter className="w-4 h-4" />
                    <span>筛选:</span>
                </div>

                <select
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                    value={filterStore}
                    onChange={e => setFilterStore(e.target.value)}
                >
                    <option value="all">全部店铺</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.remark}</option>)}
                </select>

                <select
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                >
                    <option value="all">全部状态</option>
                    <option value="active">出售中</option>
                    <option value="sold">已售出</option>
                </select>
            </div>

            {/* Proxy Error Alert */}
            {proxyError && (
                <div className="bg-slate-800 border border-slate-700 text-slate-200 px-6 py-4 rounded-xl shadow-lg flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-red-500/20 rounded-lg">
                            <Server className="w-6 h-6 text-red-400" />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-lg text-white mb-1">代理服务未启动</h4>
                            <p className="text-slate-400 text-sm mb-3">
                                浏览器禁止前端页面直接发送带有 Cookie 的请求。要获取真实数据，您的后端必须运行。
                            </p>
                            <div className="bg-black/30 rounded-lg p-3 font-mono text-sm text-green-400 border border-slate-700/50">
                                $ node proxy-server.js
                            </div>
                        </div>
                        <button onClick={() => setProxyError(false)} className="text-slate-500 hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            {/* General Error Alert */}
            {lastError && !proxyError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-3 text-sm">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold">请求失败</p>
                        <p>{lastError}</p>
                    </div>
                    <button onClick={() => setLastError(null)} className="ml-auto text-red-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Account List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map(account => (
                    <div key={account.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between group">
                        <div className="flex items-center space-x-3 overflow-hidden">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${account.status === 'active' ? 'bg-green-100 text-green-600' :
                                account.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                                }`}>
                                <Store className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-semibold text-slate-800 truncate">{account.remark}</h4>
                                </div>
                                <p className="text-xs text-slate-500 truncate">
                                    {account.status === 'loading' && '正在同步...'}
                                    {account.status === 'active' && `更新于: ${account.lastUpdated}`}
                                    {account.status === 'error' && '同步失败'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-1">
                            <button
                                onClick={() => removeAccount(account.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-colors"
                                title="移除"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {accounts.length === 0 && (
                    <div className="col-span-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                            <Store className="w-6 h-6 text-slate-400" />
                        </div>
                        <h3 className="text-slate-700 font-medium">暂无店铺账号</h3>
                        <p className="text-slate-400 text-sm mt-1">添加账号后将通过本地代理获取数据</p>
                    </div>
                )}
            </div>

            {/* Inventory Grid */}
            {accounts.length > 0 && (
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Package className="w-5 h-5 text-indigo-600" />
                        <span>商品列表 ({filteredInventory.length})</span>
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {filteredInventory.map((item) => (
                            <div key={item.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow group relative">
                                <div className="aspect-square bg-slate-100 relative overflow-hidden">
                                    {item.picUrl ? (
                                        <img src={item.picUrl} alt={item.parentTitle} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                                            <Package className="w-12 h-12" />
                                        </div>
                                    )}
                                    <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                        <div className={`text-xs px-2 py-1 rounded backdrop-blur-sm font-medium ${item.status.includes('售出') ? 'bg-slate-800/80 text-white' : 'bg-green-500/90 text-white'}`}>
                                            {item.status}
                                        </div>
                                        {/* Internal Status Badge - Only show for non-sold items */}
                                        {!item.status.includes('售出') && !item.status.includes('买家') && (
                                            item.internalStatus === 'occupied' ? (
                                                <div className="text-xs px-2 py-1 rounded backdrop-blur-sm font-medium bg-amber-500/90 text-white shadow-sm animate-pulse flex items-center gap-1 cursor-pointer hover:bg-amber-600 transition-colors"
                                                    onClick={(e) => { e.stopPropagation(); handleManualRelease(item); }}
                                                    title="点击手动释放"
                                                >
                                                    <Unlock className="w-3 h-3" />
                                                    <span>占用中</span>
                                                </div>
                                            ) : (
                                                <div className="text-xs px-2 py-1 rounded backdrop-blur-sm font-medium bg-emerald-500/90 text-white shadow-sm flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                                                    <span>空闲</span>
                                                </div>
                                            )
                                        )}
                                    </div>

                                    {/* Refresh Single Item Overlay Button */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRefreshItem(item); }}
                                        className="absolute bottom-2 right-2 p-1.5 bg-white/80 backdrop-blur-sm rounded-full text-indigo-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="刷新此商品数据"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="p-4">
                                    <div className="flex flex-col gap-1 mb-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg font-bold text-slate-900 font-mono tracking-tight">ID: {item.infoId || 'Unknown'}</span>
                                        </div>
                                        <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
                                            <span>OID:</span>
                                            <span>{item.orderId || item.childOrderId}</span>
                                        </div>
                                    </div>

                                    <h4 className="font-medium text-slate-600 text-xs line-clamp-1 mb-3" title={item.parentTitle}>
                                        {item.parentTitle}
                                    </h4>

                                    <div className="flex items-end justify-between pt-3 border-t border-slate-50">
                                        <span className="text-xl font-bold text-red-600 font-mono">
                                            <span className="text-sm font-normal mr-0.5">¥</span>{item.price}
                                        </span>
                                        <button
                                            onClick={() => openEditPrice(item)}
                                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                            title="修改价格"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="mt-2 text-xs text-slate-400 flex items-center gap-1">
                                        <Store className="w-3 h-3 text-indigo-400" />
                                        <span className="truncate max-w-[120px]">{item.accountRemark}</span>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {filteredInventory.length === 0 && accounts.length > 0 && (
                            <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 rounded-xl">
                                没有找到符合条件的商品
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Price Modal */}
            {editItem && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800">修改价格</h3>
                            <button onClick={() => setEditItem(null)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-1">当前 ID</label>
                                <div className="font-mono text-slate-500 bg-slate-100 px-3 py-1.5 rounded">{editItem.infoId}</div>
                            </div>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 mb-1">新价格 (¥)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                                    <input
                                        type="number"
                                        className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-mono text-lg"
                                        value={newPrice}
                                        onChange={e => setNewPrice(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                <p className="text-xs text-slate-400 mt-2">提示：价格必须以 8 结尾。</p>
                                {priceError && (
                                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {priceError}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={handlePriceSubmit}
                                disabled={isSubmittingPrice}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isSubmittingPrice ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                <span>确认修改</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Account Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800">添加店铺账号</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleAddAccount} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">店铺备注 <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                    placeholder="例如：主账号01"
                                    value={newRemark}
                                    onChange={e => setNewRemark(e.target.value)}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Cookie <span className="text-red-500">*</span></label>
                                <textarea
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all h-20 text-xs font-mono"
                                    placeholder="粘贴 Cookie 字符串..."
                                    value={newCookie}
                                    onChange={e => setNewCookie(e.target.value)}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Csrf-Token <span className="text-slate-400 text-xs font-normal">(可选)</span></label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                    <input
                                        type="text"
                                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-mono text-sm"
                                        placeholder="粘贴 Csrf-Token..."
                                        value={newCsrfToken}
                                        onChange={e => setNewCsrfToken(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="bg-indigo-50 p-3 rounded-lg flex items-start gap-2 border border-indigo-100">
                                <Server className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                                <div className="text-xs text-indigo-800 leading-relaxed">
                                    <span className="font-bold">必备步骤：</span>
                                    请确保您已在终端运行了 <code className="bg-white px-1 py-0.5 rounded border border-indigo-200 font-mono">node proxy-server.js</code>，否则无法绕过浏览器限制。
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>确认添加 (不自动刷新)</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};