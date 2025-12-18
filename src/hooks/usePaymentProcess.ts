import { useState, useRef, useEffect } from 'react';
import { BuyerAccount, StoreAccount, InventoryItem, Order, OrderStatus } from '../types';
import { getApiUrl, PROXY_URL } from '../config';
import { performOrderCancellation, releaseInventory } from '../utils/orderActions';

const QUEUE_TIMEOUT_MS = 60000; // 60s
const POLLING_INTERVAL_MS = 3000;

export const usePaymentProcess = () => {
    // State
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [step, setStep] = useState<number>(0);
    // Step Definition: 
    // 0: Init, 0.5: Queueing, 1: Creating, 2: Changing Price, 3: Address, 4: Link, 5: Pay Wait, 6: Success
    const [error, setError] = useState<string | null>(null);
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderCreatedAt, setOrderCreatedAt] = useState<number | null>(null);
    const [currentBuyer, setCurrentBuyer] = useState<BuyerAccount | null>(null);
    const [lockedItem, setLockedItem] = useState<InventoryItem | null>(null);
    const [queueEndTime, setQueueEndTime] = useState<number | null>(null);

    // Internal Data
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);
    const [accounts, setAccounts] = useState<StoreAccount[]>([]);
    const [settings, setSettings] = useState<any>({});

    // Helpers
    const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Initial Data Load
    useEffect(() => {
        fetch(getApiUrl('buyers'))
            .then(res => res.json())
            .then(data => Array.isArray(data) && setBuyers(data));

        // Initial shop load just for cache/display, real logic fetches fresh
        fetch(getApiUrl('settings'))
            .then(res => res.json())
            .then(data => setSettings(data))
            .catch(console.error);
    }, []);

    const saveShops = async (newAccounts: StoreAccount[]) => {
        // Optimistic UI update
        setAccounts(newAccounts);
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

    const saveOrderToBackend = async (
        status: OrderStatus,
        dataOverride?: { orderId?: string; buyer?: BuyerAccount; amount?: number; inventoryId?: string; accountId?: string }
    ) => {
        const actingOrderId = dataOverride?.orderId || orderId;
        const actingBuyer = dataOverride?.buyer || currentBuyer;

        if (!actingOrderId || !actingBuyer) return;

        try {
            const getRes = await fetch(getApiUrl('orders'));
            let existing: Order[] = [];
            if (getRes.ok) existing = await getRes.json();

            const oldOrder = existing.find(o => o.id === actingOrderId);

            const newOrder: Order = {
                id: actingOrderId,
                orderNo: `T${actingOrderId}`,
                customer: actingBuyer.remark || '测试买家',
                amount: dataOverride?.amount || oldOrder?.amount || 0,
                currency: 'CNY',
                status: status,
                channel: 'Zhuanzhuan',
                method: 'WeChat',
                createdAt: oldOrder?.createdAt || new Date().toISOString(),
                inventoryId: dataOverride?.inventoryId || oldOrder?.inventoryId || lockedItem?.id,
                accountId: dataOverride?.accountId || oldOrder?.accountId || lockedItem?.accountId,
                buyerId: actingBuyer.id
            };

            const otherOrders = existing.filter(o => o.id !== newOrder.id);
            const newOrders = [newOrder, ...otherOrders];

            await fetch(getApiUrl('orders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newOrders)
            });
        } catch (err) {
            console.error('Save order failed', err);
        }
    };

    const cancelCurrentOrder = async () => {
        if (!orderId || !currentBuyer) return;

        addLog('正在取消订单...');
        // Attempt cancellation, but don't let failure block the UI
        const success = await performOrderCancellation(orderId, currentBuyer.id);

        addLog(success ? '订单已取消' : '订单已过期');
        setStep(7); // Always force Expired UI
        setError(null); // Clear any errors

        await saveOrderToBackend(OrderStatus.CANCELLED);
        await releaseInventory(lockedItem?.id);
    };

    // Inventory Matching with Retry/Queue
    const findAndLockInventory = async (): Promise<{ item: InventoryItem; freshAccounts: StoreAccount[] }> => {
        const startTime = Date.now();
        const endTime = startTime + QUEUE_TIMEOUT_MS;
        setQueueEndTime(endTime);

        let isQueueing = false;
        let attempts = 0;

        while (Date.now() < endTime) {
            attempts++;
            // Fetch Fresh with Timestamp to avoid cache
            const sRes = await fetch(getApiUrl(`shops?_t=${Date.now()}`));
            const freshAccounts: StoreAccount[] = await sRes.json();
            const freshInventory = freshAccounts.flatMap(a => a.inventory || []);
            setAccounts(freshAccounts);

            // Fetch Settings Freshly too, in case changed
            const setRes = await fetch(getApiUrl('settings'));
            const freshSettings = await setRes.json();
            setSettings(freshSettings);

            // Determine Validity Duration (Default 180s if not set)
            const validityMs = (freshSettings?.validityDuration ? Number(freshSettings.validityDuration) : 180) * 1000;

            const idleItems = freshInventory.filter(i => {
                // Primary Filter: Must be '出售中' (ZZ status)
                // Internal Status Check: 'idle' OR 'occupied' but expired
                const isOccupied = i.internalStatus === 'occupied';
                const isExpired = isOccupied && i.lastMatchedTime && (Date.now() - i.lastMatchedTime > validityMs);

                // If it's idle, OR it's occupied but expired, we consider it available
                const isInternalAvailable = (i.internalStatus === 'idle' || !i.internalStatus || isExpired);

                return i.status.includes('出售') && isInternalAvailable;
            }).filter(i => {
                // Filter by Product Mode
                if (freshSettings?.productMode === 'shop' && freshSettings?.specificShopId) {
                    return i.accountId === freshSettings.specificShopId;
                }
                return true;
            });

            if (idleItems.length > 0) {
                // Found!
                const item = idleItems[Math.floor(Math.random() * idleItems.length)];

                // Lock it
                const updatedAccounts = freshAccounts.map(a => ({
                    ...a,
                    inventory: a.inventory?.map(i => i.id === item.id ? { ...i, internalStatus: 'occupied' as const, lastMatchedTime: Date.now() } : i)
                }));
                await saveShops(updatedAccounts);

                if (isQueueing) addLog('排队结束，匹配成功！');
                return { item, freshAccounts: updatedAccounts };
            }

            // Not found, enter queue mode if not already
            if (!isQueueing) {
                isQueueing = true;
                setStep(0.5); // Queue Step
                addLog('当前订单过多，进入排队模式...');
            }

            // Wait before retry
            await delay(attempts < 3 ? 1000 : POLLING_INTERVAL_MS); // Faster retry at first
        }

        setQueueEndTime(null);
        throw new Error('当前过于繁忙，请稍后重试');
    };

    const startPayment = async (amount: number, buyerId?: string) => {
        setLoading(true);
        setLogs([]);
        setError(null);
        setStep(1); // Default strictly to creating
        setPaymentLink(null);
        setOrderId(null);
        setOrderCreatedAt(Date.now());
        setQueueEndTime(null);

        try {
            // 1. Inventory Match (Handles Queueing internally)
            let item: InventoryItem, freshAccounts: StoreAccount[];
            try {
                const result = await findAndLockInventory();
                item = result.item;
                freshAccounts = result.freshAccounts;
                setLockedItem(item);
                addLog(`匹配商品: ${item.parentTitle.substring(0, 15)}...`);
                setStep(1); // Back to creating
            } catch (e: any) {
                throw e;
            }

            // 2. Select Buyer
            let buyer: BuyerAccount | undefined;
            // Always refresh buyers list to get latest status/addressId
            const bRes = await fetch(getApiUrl('buyers'));
            const freshBuyers: BuyerAccount[] = await bRes.json();
            setBuyers(freshBuyers);

            if (buyerId) {
                buyer = freshBuyers.find(b => b.id === buyerId);
            } else if (settings?.pullMode === 'specific' && settings?.specificBuyerId) {
                buyer = freshBuyers.find(b => b.id === settings.specificBuyerId);
            } else {
                buyer = freshBuyers[Math.floor(Math.random() * freshBuyers.length)];
            }

            if (!buyer) throw new Error('未找到可用买家账号');
            setCurrentBuyer(buyer);

            // 3. Get Seller & Change Price
            const seller = freshAccounts.find(a => a.id === item.accountId);
            if (!seller) throw new Error('卖家账号异常');

            setStep(2);
            const targetCents = Math.round(amount * 100);
            addLog(`正在改价为 ¥${amount}...`);

            const changePriceUrl = `https://app.zhuanzhuan.com/zzopen/c2b_consignment/changePrice?argueSwitch=true&buyPrice=0&orderId=${item.childOrderId}&infoPrice=${targetCents}&infoShowPrice=${targetCents}&selectedFastWithdrawService=0`;
            const cpRes = await proxyRequest(changePriceUrl, seller.cookie);
            if (cpRes.respCode !== '0' && cpRes.respData?.optResult !== true) {
                throw new Error(`改价失败: ${cpRes.errorMsg}`);
            }
            addLog('改价成功');

            // 4. Get Address
            setStep(3);
            let addressId = buyer.addressId;
            if (addressId) {
                addLog(`使用预设收货地址 (ID: ${addressId})`);
            } else {
                const addrRes = await proxyRequest(`https://app.zhuanzhuan.com/zz/transfer/getAllAddress?_t=${Date.now()}`, buyer.cookie);
                addressId = addrRes.respData?.[0]?.id;
                if (!addressId) throw new Error('买家账号无收货地址');
            }

            // 5. Create Order
            addLog('正在下单...');
            const createOrderData = {
                apiVersion: "V3_INSURANCE_SERVICE", payActionType: "1", mutiProduct: "1", payType: "0", supportCent: "1",
                addressId: addressId,
                productStr: JSON.stringify([{
                    channelId: "", metric: "", payType: "0", serviceList: ["40"], infoNum: "1", infoId: item.infoId
                }]),
                buyerRemark: "", packIds: "[]", saleIds: "[]",
                deliveryInfos: JSON.stringify([{ infoId: item.infoId, deliveryInfo: { deliveryMethodId: "1", versionId: "0" } }]),
                tradeType: "0", captureState: "-1", infoId: item.infoId, infoNum: "", init_from: "G1001_yxyl_diamond_5820_4", whetherShowPosteriorQcStyle: "0"
            };
            const params = new URLSearchParams();
            Object.entries(createOrderData).forEach(([k, v]) => params.append(k, v));

            const orderRes = await proxyRequest(
                'https://app.zhuanzhuan.com/zz/transfer/createOrder', buyer.cookie, 'POST', params.toString(),
                { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }
            );

            if (orderRes.respCode !== '0') throw new Error(`下单失败: ${orderRes.respData || orderRes.errorMsg}`);

            const newOrderId = orderRes.respData.orderId;
            const payId = orderRes.respData.payId;

            // Generate Short ID
            const shortId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10).toString(); // e.g., 23456789

            setOrderId(newOrderId);
            setOrderCreatedAt(Date.now());
            addLog(`下单成功! 订单号: ${newOrderId}`);

            // 6. Get Payment Link
            setStep(4);
            const payListData = [{ "payMethod": "0", "tradeType": "NEW_TRADE", "money": `${targetCents}`, "extendParam": { "frontEndType": "3", "appName": "转转官网", "appBundleId": "https://m.zhuanzhuan.58.com", "payConfigId": "showChannel:SHOW_WX;nameRuleId:1821105009618587136", "instalmentNum": "0", "cmbToken": "", "payConfigKey": "showChannel:SHOW_WX;nameRuleId:1821105009618587136" }, "tradeTypeKey": "NEW_TRADE" }];
            const payParams = new URLSearchParams();
            payParams.append('reqSource', '1'); payParams.append('mchId', '1001'); payParams.append('payId', payId); payParams.append('payMode', 'base'); payParams.append('captureState', '-1');
            payParams.append('payList', JSON.stringify(payListData));

            const payRes = await proxyRequest(
                'https://app.zhuanzhuan.com/zz/transfer/saveCashierDeskInfo', buyer.cookie, 'POST', payParams.toString(),
                { 'Content-Type': 'application/x-www-form-urlencoded' }
            );

            const mWebUrl = payRes.respData?.thirdPayInfodata?.[0]?.payData?.mWebUrl;
            if (!mWebUrl) throw new Error('未获取到微信跳转链接');

            // Save Pending Order
            await saveOrderToBackend(OrderStatus.PENDING, {
                orderId: newOrderId, buyer, amount, inventoryId: item.id, accountId: item.accountId
            });

            // 7. Deep Link Conversion
            const deepRes = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl: mWebUrl, method: 'GET', headers: { 'Referer': 'https://m.zhuanzhuan.com/' } })
            });
            const htmlText = await deepRes.text();

            const match = htmlText.match(/weixin:\/\/wap\/pay[^"]+/);
            const match2 = htmlText.match(/deeplink\s*:\s*"(weixin:[^"]+)"/);

            if (match) setPaymentLink(match[0]);
            else if (match2) setPaymentLink(match2[1]);
            else throw new Error('无法解析最终支付链接');

            setStep(5);
            return { shortId, amount }; // Return data for UI

        } catch (e: any) {
            setError(e.message);
            addLog(`错误: ${e.message}`);
            // Revert Lock on Error
            if (lockedItem) await releaseInventory(lockedItem.id);
            if (e.message.includes('繁忙')) setStep(0);
            else setStep(0); // Always reset UI
        } finally {
            setLoading(false);
            setQueueEndTime(null);
        }
    };

    // Polling Logic for Status
    useEffect(() => {
        let interval: any;
        if (step === 5 && orderId && currentBuyer) {
            interval = setInterval(async () => {
                try {
                    const url = `https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=${orderId}&abGroup=2`;
                    const res = await proxyRequest(url, currentBuyer.cookie);
                    const statusStr = res.respData?.status;
                    const statusInfo = res.respData?.statusInfo;

                    if (statusStr === '3' || statusInfo?.includes('待发货') || statusInfo?.includes('已支付')) {
                        setStep(6);
                        clearInterval(interval);
                        await releaseInventory(lockedItem?.id);
                        saveOrderToBackend(OrderStatus.SUCCESS);
                    } else if (statusStr === '19' || statusInfo?.includes('已取消')) {
                        clearInterval(interval);
                        saveOrderToBackend(OrderStatus.CANCELLED);
                    }
                } catch (e) { console.error(e); }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [step, orderId, currentBuyer]);

    return {
        startPayment,
        cancelCurrentOrder,
        loading,
        logs,
        step,
        error,
        paymentLink,
        orderId,
        orderCreatedAt,
        queueEndTime,
        settings, // Export settings
    };
};
