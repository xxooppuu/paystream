import { useState, useCallback } from 'react';
import { InventoryItem, Order, StoreAccount, OrderStatus } from '../types';
import { getApiUrl } from '../config';
import { releaseInventory } from '../utils/orderActions';

const POLLING_INTERVAL_MS = 3000;
const QUEUE_TIMEOUT_MS = 60000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const usePaymentProcess = (amount: number, onComplete: (order: Order) => void) => {
    const [step, setStep] = useState(0); // 0: Idle, 0.5: Queue, 1: Scanning, 2: Matched, 3: Changing Price, 4: Ordering, 5: Payment Link, 6: Success
    const [logs, setLogs] = useState<string[]>([]);
    const [matchedItem, setMatchedItem] = useState<InventoryItem | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [queueEndTime, setQueueEndTime] = useState<number | null>(null);
    const [freshAccounts, setAccounts] = useState<StoreAccount[]>([]);
    const [, setSettings] = useState<any>(null);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        setLogs(prev => [`[${time}] ${msg}`, ...prev]);
    };

    // v1.8.1: Server-Side Atomic Match & Lock with Timeout
    const findAndLockInventory = async (excludeIds: string[] = []): Promise<{ item: InventoryItem; freshAccounts: StoreAccount[] }> => {
        const startTime = Date.now();
        const endTime = startTime + QUEUE_TIMEOUT_MS;
        setQueueEndTime(endTime);

        let isQueueing = false;
        let attempts = 0;

        while (Date.now() < endTime) {
            attempts++;

            // 1. Fetch Latest Settings
            const setRes = await fetch(getApiUrl('settings') + `&_t=${Date.now()}`);
            const freshSettings = await setRes.json();
            setSettings(freshSettings);

            if (attempts === 1) {
                addLog(`🔍 扫描库存 (第${attempts}次): 正在请求服务端原子匹配...`);
            }

            // 2. Call Server-Side Atomic Match with Timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                const matchRes = await fetch(getApiUrl('match_and_lock'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        price: amount,
                        time: Date.now(),
                        filters: {
                            specificShopId: freshSettings?.productMode === 'shop' ? freshSettings?.specificShopId : null,
                            excludeIds: excludeIds,
                            validityDuration: freshSettings?.validityDuration || 180
                        }
                    })
                });
                clearTimeout(timeoutId);

                if (matchRes.ok) {
                    const result = await matchRes.json();
                    if (result.success) {
                        if (isQueueing) addLog('排队结束，匹配成功！');
                        addLog(`✅ 匹配成功: ${result.data.item.title || result.data.item.id}`);
                        return {
                            item: result.data.item,
                            freshAccounts: [result.data.account]
                        };
                    }
                } else if (matchRes.status === 404) {
                    if (!isQueueing) {
                        isQueueing = true;
                        setStep(0.5);
                        addLog('当前订单过多，进入排队模式...');
                    }
                } else {
                    const errorData = await matchRes.json().catch(() => ({}));
                    const errMsg = errorData.error || 'Server matching failed';
                    addLog(`❌ 匹配失败: ${errMsg}`);
                    throw new Error(errMsg);
                }
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    addLog('⚠️ 匹配请求超时，正在重试...');
                } else {
                    throw err;
                }
            } finally {
                clearTimeout(timeoutId);
            }

            await delay(attempts < 3 ? 1000 : POLLING_INTERVAL_MS);
        }

        setQueueEndTime(null);
        throw new Error('当前过于繁忙，请稍后重试');
    };

    const startProcess = useCallback(async () => {
        try {
            setError(null);
            setStep(1);
            setLogs([]);
            setMatchedItem(null);
            setOrder(null);

            const { item, freshAccounts: currAccounts } = await findAndLockInventory();
            setMatchedItem(item);
            setAccounts(currAccounts);
            setStep(2);

            setStep(3);
            addLog(`正在改价为 ¥${amount}...`);
            const sellerAccount = currAccounts.find(a => a.id === item.accountId);
            if (!sellerAccount) throw new Error('卖家账号异常');

            const changePriceRes = await fetch(getApiUrl('proxy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: 'https://app.zhuanzhuan.com/zzx/transfer/modifyProductPrice',
                    method: 'POST',
                    cookie: sellerAccount.cookie,
                    body: `productId=${item.id}&price=${amount * 100}`,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                })
            });
            const priceData = await changePriceRes.json();
            if (priceData.respCode !== '0') throw new Error(priceData.respMsg || '改价失败');
            addLog('改价成功');

            setStep(4);
            addLog('正在下单...');
            const bRes = await fetch(getApiUrl('buyers'));
            const buyers = await bRes.json();
            const buyer = buyers.find((b: any) => b.status === '正常' || b.status === undefined);
            if (!buyer) throw new Error('可用买家账号不足');

            const orderRes = await fetch(getApiUrl('proxy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: 'https://app.zhuanzhuan.com/zzx/transfer/createOrder',
                    method: 'POST',
                    cookie: buyer.cookie,
                    body: `productId=${item.id}&price=${amount * 100}&addressId=${buyer.addressId || ''}`,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                })
            });
            const orderData = await orderRes.json();
            if (orderData.respCode !== '0') throw new Error(orderData.respMsg || '下单失败');

            // v1.8.2: Type-safe order creation
            const newOrder: Order = {
                id: `ZZPAY${Date.now()}`,
                orderNo: orderData.respData.orderId,
                customer: buyer.remark || 'Guest',
                amount,
                currency: 'CNY',
                status: OrderStatus.PENDING,
                channel: 'default',
                method: 'default',
                createdAt: new Date().toISOString(),
                buyerId: buyer.id,
                inventoryId: item.id,
                accountId: item.accountId
            };

            await fetch(getApiUrl('add_order'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newOrder)
            });

            setOrder(newOrder);
            addLog(`下单成功! 订单号: ${newOrder.orderNo}`);
            setStep(5);

            setTimeout(() => {
                setStep(6);
                onComplete(newOrder);
            }, 1000);

        } catch (e: any) {
            const msg = typeof e === 'string' ? e : e.message;
            setError(msg);
            addLog(`❌ 进程错误: ${msg}`);
            if (matchedItem) releaseInventory(matchedItem.id);
            setStep(0);
        }
    }, [amount, onComplete, matchedItem]);

    return { step, logs, matchedItem, order, error, queueEndTime, startProcess, freshAccounts };
};
