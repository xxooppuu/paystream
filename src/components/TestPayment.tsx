import React, { useState, useEffect, useRef } from 'react';
import {
    CreditCard,
    RefreshCw,
    AlertTriangle,
    CheckCircle,
    Clock,
    ArrowRight,
    ExternalLink,
    QrCode,
    Smartphone
} from 'lucide-react';
import { StoreAccount, InventoryItem, ZZResponse, BuyerAccount, Order, OrderStatus, PaymentMethod } from '../types';
import { getApiUrl, PROXY_URL } from '../config';

export const TestPayment: React.FC = () => {
    // Config & Data
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);
    const [accounts, setAccounts] = useState<StoreAccount[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [pullMode, setPullMode] = useState<'random' | 'specific'>('random');

    // UI Inputs
    const [amount, setAmount] = useState<string>('298');
    const [selectedBuyerId, setSelectedBuyerId] = useState<string>('');

    // Process State
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [step, setStep] = useState<number>(0); // 0: Idle, 1: Matching, 2: Changing Price, 3: Creating Order, 4: Getting Payment, 5: Awaiting Payment
    const [error, setError] = useState<string | null>(null);

    // Result State
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [currentBuyer, setCurrentBuyer] = useState<BuyerAccount | null>(null);
    const [lockedItem, setLockedItem] = useState<InventoryItem | null>(null);

    // Ref for amount to access in closures
    const amountRef = useRef(amount);
    useEffect(() => { amountRef.current = amount; }, [amount]);

    // Load Data
    useEffect(() => {
        setPullMode(localStorage.getItem('pullMode') as any || 'random');

        // Load buyers
        fetch(getApiUrl('buyers'))
            .then(res => res.json())
            .then(data => Array.isArray(data) && setBuyers(data));

        // Load shops (and inventory)
        fetch(getApiUrl('shops'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setAccounts(data);
                    // Flatten inventory
                    const allItems = data.flatMap((a: StoreAccount) => a.inventory || []);
                    setInventory(allItems);
                }
            });
    }, []);

    const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

    const saveShops = async (newAccounts: StoreAccount[]) => {
        await fetch(getApiUrl('shops'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newAccounts)
        });
    };

    const proxyRequest = async (targetUrl: string, cookie: string, method: string = 'GET', body: any = null, headers: any = {}) => {
        const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl,
                cookie,
                method,
                body,
                headers
            })
        });
        return await res.json();
    };

    // Helper: Save Order (Upsert)
    // Pass explicit data to avoid stale state in closures (especially during async flows)
    const saveOrderToBackend = async (
        status: OrderStatus,
        isManual = false,
        dataOverride?: { orderId?: string; buyer?: BuyerAccount; amount?: number; inventoryId?: string; accountId?: string }
    ) => {
        const actingOrderId = dataOverride?.orderId || orderId;
        const actingBuyer = dataOverride?.buyer || currentBuyer;
        const actingAmount = dataOverride?.amount !== undefined ? dataOverride.amount : parseFloat(amountRef.current);
        const actingInvId = dataOverride?.inventoryId || lockedItem?.id;
        const actingAccId = dataOverride?.accountId || lockedItem?.accountId;

        if (!actingOrderId || !actingBuyer) {
            if (isManual) alert('无法保存：缺少订单ID或买家信息');
            return;
        }

        try {
            // Construct Order
            const newOrder: Order = {
                id: actingOrderId,
                orderNo: `T${actingOrderId}`,
                customer: actingBuyer.remark || '测试买家',
                amount: actingAmount,
                currency: 'CNY',
                status: status,
                channel: 'Zhuanzhuan',
                method: 'WeChat',
                createdAt: new Date().toISOString(),
                inventoryId: actingInvId,
                accountId: actingAccId,
                buyerId: actingBuyer.id
            };

            // Get existing
            const getRes = await fetch(getApiUrl('orders'));
            let existing: Order[] = [];
            if (getRes.ok) existing = await getRes.json();

            // Upsert Logic
            const otherOrders = existing.filter(o => o.id !== newOrder.id);
            // If updating, preserve original time?
            const oldOrder = existing.find(o => o.id === newOrder.id);
            if (oldOrder) {
                newOrder.createdAt = oldOrder.createdAt;
                // If status is advancing (pending -> success), allow it.
                // If status is already SUCCESS or CANCELLED, be careful not to revert?
                // Use the new status passed in.

                // Keep original IDs if missing in new? No, we trust acting data.
                if (!newOrder.inventoryId) newOrder.inventoryId = oldOrder.inventoryId;
                if (!newOrder.accountId) newOrder.accountId = oldOrder.accountId;
                if (!newOrder.buyerId) newOrder.buyerId = oldOrder.buyerId;
            }

            const newOrders = [newOrder, ...otherOrders];

            // Save
            const saveRes = await fetch(getApiUrl('orders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newOrders)
            });

            if (saveRes.ok) {
                if (status === OrderStatus.SUCCESS) {
                    addLog(`订单状态已更新为: ${status}`);
                } else {
                    console.log('Order saved as PENDING');
                }
                if (isManual) alert('保存成功！');
            } else {
                throw new Error('Save failed: ' + saveRes.status);
            }
        } catch (err) {
            console.error('Save order failed', err);
            if (isManual) alert('保存失败，请检查Proxy是否运行');
        }
    };

    /**
     * Main Flow: Generate Payment
     */
    const handleGeneratePayment = async () => {
        setLoading(true);
        setLogs([]);
        setError(null);
        setStep(1);
        setPaymentLink(null);
        setOrderId(null);

        try {
            // 1. Select Buyer
            let buyer: BuyerAccount | undefined;
            if (pullMode === 'specific') {
                buyer = buyers.find(b => b.id === selectedBuyerId);
            } else {
                buyer = buyers[Math.floor(Math.random() * buyers.length)];
            }

            if (!buyer) throw new Error('未找到可用买家账号');
            setCurrentBuyer(buyer);
            addLog(`买家账号: ${buyer.remark}`);

            // 2. Match Idle Item
            // Refresh inventory from server to ensure latest state? Ideally yes, but for now use local state + safety check
            const idleItems = inventory.filter(i =>
                // Must be active selling status AND idle internal status
                i.status.includes('出售') &&
                (i.internalStatus === 'idle' || !i.internalStatus)
                // Timeout check: if occupied > 3 mins ago, force release? (Implemented later)
            );

            if (idleItems.length === 0) throw new Error('库存不足 (无空闲商品)');

            // Random pick
            const item = idleItems[Math.floor(Math.random() * idleItems.length)];
            setLockedItem(item);
            addLog(`匹配商品: ${item.parentTitle.substring(0, 15)}... (ID: ${item.infoId})`);

            // Lock Item (Optimistic UI + Save)
            item.internalStatus = 'occupied';
            item.lastMatchedTime = Date.now();
            // Update Account Tree
            const updatedAccounts = accounts.map(a => {
                if (a.id === item.accountId) {
                    return {
                        ...a,
                        inventory: a.inventory?.map(i => i.id === item.id ? item : i)
                    };
                }
                return a;
            });
            setAccounts(updatedAccounts); // Update UI
            saveShops(updatedAccounts); // Persist Lock
            addLog('商品已锁定');


            // 3. Get Seller Account
            const seller = accounts.find(a => a.id === item.accountId);
            if (!seller) throw new Error('卖家账号异常');


            // 4. Change Price (using Seller Cookie)
            setStep(2);
            const targetPriceVal = parseFloat(amount);
            const targetCents = Math.round(targetPriceVal * 100);

            // Validation for price ending in 8? The user mention "Test payment... input 298... change to 298".
            // User didn't say "only 8 ending for test". But `Inventory` module has that rule.
            // Assuming test payment input MUST follow rule or force it? Let's just try.

            addLog(`正在改价为 ¥${amount}...`);
            const changePriceUrl = `https://app.zhuanzhuan.com/zzopen/c2b_consignment/changePrice?argueSwitch=true&buyPrice=0&orderId=${item.childOrderId}&infoPrice=${targetCents}&infoShowPrice=${targetCents}&selectedFastWithdrawService=0`;
            const cpRes = await proxyRequest(changePriceUrl, seller.cookie);

            if (cpRes.respCode !== '0' && cpRes.respData?.optResult !== true) {
                throw new Error(`改价失败: ${cpRes.errorMsg || 'Unknown'}`);
            }
            addLog('改价成功');


            // 5. Get Buyer Address (using Buyer Cookie)
            setStep(3);
            addLog('获取收货地址...');
            const addrRes = await proxyRequest('https://app.zhuanzhuan.com/zz/transfer/getAllAddress', buyer.cookie);
            const addressId = addrRes.respData?.[0]?.id; // Use first address
            if (!addressId) throw new Error('买家账号无收货地址');
            addLog(`使用地址ID: ${addressId}`);


            // 6. Create Order (using Buyer Cookie)
            addLog('正在下单...');
            const createOrderData = {
                apiVersion: "V3_INSURANCE_SERVICE",
                payActionType: "1",
                mutiProduct: "1",
                payType: "0",
                supportCent: "1",
                addressId: addressId,
                productStr: JSON.stringify([{
                    channelId: "",
                    metric: "",
                    payType: "0",
                    serviceList: ["40"], // "40" from example, likely necessary service
                    infoNum: "1",
                    infoId: item.infoId
                }]),
                buyerRemark: "",
                packIds: "[]",
                saleIds: "[]",
                deliveryInfos: JSON.stringify([{
                    infoId: item.infoId,
                    deliveryInfo: { deliveryMethodId: "1", versionId: "0" }
                }]),
                tradeType: "0",
                captureState: "-1",
                infoId: item.infoId,
                infoNum: "",
                init_from: "G1001_yxyl_diamond_5820_4", // from example
                whetherShowPosteriorQcStyle: "0"
            };

            // Convert object to URLSearchParams string manually for x-www-form-urlencoded
            const params = new URLSearchParams();
            Object.entries(createOrderData).forEach(([k, v]) => params.append(k, v));

            const orderRes = await proxyRequest(
                'https://app.zhuanzhuan.com/zz/transfer/createOrder',
                buyer.cookie,
                'POST',
                params.toString(),
                { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }
            );

            if (orderRes.respCode !== '0') throw new Error(`下单失败: ${orderRes.respData || orderRes.errorMsg}`);

            const newOrderId = orderRes.respData.orderId;
            const payId = orderRes.respData.payId;
            setOrderId(newOrderId);
            addLog(`下单成功! 订单号: ${newOrderId}`);


            // 7. Get Payment Link (Cashier Desk)
            setStep(4);
            addLog('获取支付链接...');
            const payListData = [{ "payMethod": "0", "tradeType": "NEW_TRADE", "money": `${targetCents}`, "extendParam": { "frontEndType": "3", "appName": "转转官网", "appBundleId": "https://m.zhuanzhuan.58.com", "payConfigId": "showChannel:SHOW_WX;nameRuleId:1821105009618587136", "instalmentNum": "0", "cmbToken": "", "payConfigKey": "showChannel:SHOW_WX;nameRuleId:1821105009618587136" }, "tradeTypeKey": "NEW_TRADE" }];

            const payParams = new URLSearchParams();
            payParams.append('reqSource', '1');
            payParams.append('mchId', '1001');
            payParams.append('payId', payId);
            payParams.append('payMode', 'base');
            payParams.append('captureState', '-1');
            payParams.append('payList', JSON.stringify(payListData));

            // Additional headers might be needed here (zzReqVersion, etc from example?)
            // Let's try minimal first.
            const payRes = await proxyRequest(
                'https://app.zhuanzhuan.com/zz/transfer/saveCashierDeskInfo',
                buyer.cookie,
                'POST',
                payParams.toString(),
                { 'Content-Type': 'application/x-www-form-urlencoded' }
            );

            if (payRes.respCode !== '0') throw new Error(`获取支付信息失败: ${payRes.errorMsg}`);

            const mWebUrl = payRes.respData?.thirdPayInfodata?.[0]?.payData?.mWebUrl;
            if (!mWebUrl) throw new Error('未获取到微信跳转链接');

            // --- SAVE PENDING ORDER HERE (Guaranteed) ---
            // Pass explicit values because 'orderId' state update is async and won't be ready yet
            await saveOrderToBackend(OrderStatus.PENDING, false, {
                orderId: newOrderId,
                buyer: buyer,
                amount: targetPriceVal,
                inventoryId: item.id,
                accountId: item.accountId
            });
            // ---------------------------------------------

            addLog('获取到中间链接，正在转换...');


            // 8. Convert to Deep Link (Format Conversion)
            // Proxy the mWebUrl with Referer headers to get the redirect location or content
            // We use the proxy to fetch the mWebUrl (which returns an HTML page with the deep link)

            // Use raw fetch to get text response, do not assume JSON
            const deepRes = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: mWebUrl,
                    method: 'GET',
                    headers: { 'Referer': 'https://m.zhuanzhuan.com/' }
                })
            });

            // The proxy server returns the target response body directly.
            // Since checkmweb returns HTML, we must read it as text.
            const htmlText = await deepRes.text();

            // Regex extract: "weixin://wap/pay..."
            const match = htmlText.match(/weixin:\/\/wap\/pay[^"]+/);
            if (match) {
                setPaymentLink(match[0]);
                addLog('核心支付链接获取成功!');
                setStep(5);
            } else {
                // Sometimes it's in a slightly different format or double encoded
                const match2 = htmlText.match(/deeplink\s*:\s*"(weixin:[^"]+)"/);
                if (match2) {
                    setPaymentLink(match2[1]);
                    addLog('核心支付链接获取成功!');
                    setStep(5);
                } else {
                    // Log a snippet for debugging if failed
                    console.log('Deep Link HTML:', htmlText.substring(0, 500));
                    throw new Error('无法解析最终支付链接，可能是Referer校验失败或Cookie失效');
                }
            }

        } catch (e: any) {
            setError(e.message);
            addLog(`错误: ${e.message}`);
            setLoading(false);
            // Clean up lock if failed?
            if (lockedItem) {
                // Revert
                const freshRes = await fetch(getApiUrl('shops'));
                if (freshRes.ok) {
                    const freshShops: StoreAccount[] = await freshRes.json();
                    const reverted = freshShops.map(a => ({
                        ...a,
                        inventory: a.inventory?.map(i => i.id === lockedItem.id ? { ...i, internalStatus: 'idle' as const } : i)
                    }));
                    setAccounts(reverted);
                    saveShops(reverted);
                }
            }
        }
        setLoading(false);
    };

    /**
     * Monitor Order Status
     */
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        if (step === 5 && orderId && currentBuyer) {
            interval = setInterval(async () => {
                try {
                    // Poll `getOrder`
                    const url = `https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=${orderId}&abGroup=2`;
                    const res = await proxyRequest(url, currentBuyer.cookie);

                    // Check status
                    const statusStr = res.respData?.status;
                    const statusInfo = res.respData?.statusInfo;

                    // Logic: status '3' = Paid/To Deliver. status '19' = Cancelled. status '1' = Pending.
                    // Also check statusInfo text for robustness.

                    if (statusStr === '3' || statusInfo?.includes('待发货') || statusInfo?.includes('已支付')) {
                        addLog(`订单状态变更为: ${statusInfo}`);
                        setStep(6); // Success
                        clearInterval(interval);
                        addLog('支付成功! 订单完成。');

                        // Update Item to Idle (Release lock) locally so platform status takes over
                        if (lockedItem) {
                            const updated = accounts.map(a => ({
                                ...a,
                                inventory: a.inventory?.map(i => i.id === lockedItem.id ? { ...i, internalStatus: 'idle' as const } : i)
                            }));
                            setAccounts(updated);
                            saveShops(updated);
                        }

                        // Auto Save
                        saveOrderToBackend(OrderStatus.SUCCESS);
                    } else if (statusStr === '19' || statusInfo?.includes('已取消')) {
                        addLog(`订单已取消: ${statusInfo}`);
                        clearInterval(interval);
                        saveOrderToBackend(OrderStatus.CANCELLED);
                    } else if (statusStr === '17' || statusInfo?.includes('退款完成')) {
                        addLog(`订单已退款: ${statusInfo}`);
                        clearInterval(interval);
                        saveOrderToBackend(OrderStatus.REFUNDED);
                    } else if (statusInfo && statusInfo !== '待付款') {
                        // Log other changes
                        addLog(`订单状态: ${statusInfo} (State: ${statusStr})`);
                    }
                } catch (e) {
                    console.error('Polling error', e);
                }
            }, 3000);
        }
        return () => { if (interval) clearInterval(interval); };
    }, [step, orderId, currentBuyer]);


    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">支付测试</h2>
                    <p className="text-slate-500 text-sm">全自动流程：匹配 &rarr; 改价 &rarr; 下单 &rarr; 支付</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Controls */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                    <div className="space-y-4">
                        {/* Amount Input */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">测试金额 (¥)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                                <input
                                    type="number"
                                    className="w-full pl-8 pr-4 py-3 border border-slate-300 rounded-lg text-lg font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Buyer Selection */}
                        {pullMode === 'specific' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">选择拉单买家</label>
                                <select
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none"
                                    value={selectedBuyerId}
                                    onChange={e => setSelectedBuyerId(e.target.value)}
                                >
                                    <option value="">请选择...</option>
                                    {buyers.map(b => (
                                        <option key={b.id} value={b.id}>{b.remark} (成功:{b.successOrders})</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <button
                            onClick={handleGeneratePayment}
                            disabled={loading || (pullMode === 'specific' && !selectedBuyerId)}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                        >
                            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
                            <span>生成测试支付</span>
                        </button>
                    </div>

                    {/* Logs Console */}
                    <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 h-48 overflow-y-auto space-y-1">
                        {logs.length === 0 && <span className="text-slate-600">等待操作...</span>}
                        {logs.map((log, i) => <div key={i}>{log}</div>)}
                    </div>
                </div>

                {/* Result Display */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[400px]">
                    {!paymentLink && !loading && (
                        <div className="text-center text-slate-400 space-y-4">
                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                                <QrCode className="w-10 h-10" />
                            </div>
                            <p>支付二维码将显示在这里</p>
                        </div>
                    )}

                    {paymentLink && (
                        <div className="w-full flex flex-col items-center animate-fade-in">
                            <div className="bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 mb-6">
                                <CheckCircle className="w-4 h-4" />
                                <span>支付链接已生成 (3分钟有效)</span>
                            </div>

                            {/* QR Code Placeholder - In real app use 'qrcode.react' */}
                            <div className="border-4 border-slate-900 p-2 rounded-xl mb-6">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentLink)}`}
                                    alt="Payment QR"
                                    className="w-48 h-48"
                                />
                            </div>

                            <div className="w-full bg-slate-50 p-4 rounded-lg border border-slate-200 break-all text-xs text-slate-500 font-mono mb-6">
                                {paymentLink}
                            </div>

                            <div className="flex gap-4 w-full">
                                <a
                                    href={paymentLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold text-center flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Smartphone className="w-4 h-4" />
                                    <span>跳转微信支付</span>
                                </a>
                            </div>

                            <div className="mt-8 flex items-center gap-2 text-sm text-slate-400">
                                <Clock className="w-4 h-4" />
                                <span>正在等待支付结果...</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
