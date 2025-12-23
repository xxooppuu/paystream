import { useState, useCallback } from 'react';
import { InventoryItem, Order, StoreAccount, OrderStatus } from '../types';
import { getApiUrl } from '../config';
import { releaseInventory } from '../utils/orderActions';

const POLLING_INTERVAL_MS = 3000;
const QUEUE_TIMEOUT_MS = 60000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const usePaymentProcess = () => {
    const [step, setStep] = useState(0); // 0: Idle, 0.5: Queue, 1: Scanning, 2: Matched, 3: Changing Price, 4: Ordering, 5: Payment Link, 6: Success
    const [logs, setLogs] = useState<string[]>([]);
    const [matchedItem, setMatchedItem] = useState<InventoryItem | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [queueEndTime, setQueueEndTime] = useState<number | null>(null);
    const [freshAccounts, setAccounts] = useState<StoreAccount[]>([]);
    const [paymentLink, setPaymentLink] = useState<string>('');
    const [lockTicket, setLockTicket] = useState<string | null>(null);
    const [settings, setSettings] = useState<any>(null);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        setLogs(prev => [`[${time}] ${msg}`, ...prev]);
    };

    const loading = step > 0 && step < 6;

    // v1.8.x: Server-Side Atomic Match & Lock with Timeout
    const findAndLockInventory = async (amount: number, excludeIds: string[] = []): Promise<{ item: InventoryItem; freshAccounts: StoreAccount[] }> => {
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
                        setLockTicket(result.lockTicket);
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

    const startPayment = useCallback(async (amount: number, specificBuyerId?: string) => {
        let currentMatchedItem: InventoryItem | null = null;
        try {
            setError(null);
            setStep(1);
            setLogs([]);
            setMatchedItem(null);
            setOrder(null);
            setPaymentLink('');

            // 1. Match & Lock (Server Atomic)
            const { item, freshAccounts: currAccounts } = await findAndLockInventory(amount);
            currentMatchedItem = item;
            setMatchedItem(item);
            setAccounts(currAccounts);
            setStep(2);

            // 2. Change Price
            setStep(3);
            addLog(`正在改价为 ¥${amount}...`);
            const sellerAccount = currAccounts.find(a => a.id === item.accountId);
            if (!sellerAccount) throw new Error('卖家账号异常');

            const cents = Math.round(amount * 100);
            const changePriceRes = await fetch(getApiUrl('proxy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: `https://app.zhuanzhuan.com/zzopen/c2b_consignment/changePrice?argueSwitch=true&buyPrice=0&orderId=${item.id}&infoPrice=${cents}&infoShowPrice=${cents}&selectedFastWithdrawService=0`,
                    method: 'GET',
                    cookie: sellerAccount.cookie,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 zzVersion/11.21.5 zzT/16 zzDevice/1_141.0_3.0 zzApp/58ZhuanZhuan',
                        'Referer': 'https://m.zhuanzhuan.com/',
                        ...(sellerAccount.csrfToken ? { 'Csrf-Token': sellerAccount.csrfToken } : {})
                    }
                })
            })

            // v1.8.9: Robust JSON parsing to handle HTML/Proxy errors gracefully
            let priceData;
            try {
                if (!changePriceRes.ok) {
                    throw new Error(`HTTP ${changePriceRes.status}`);
                }
                const text = await changePriceRes.text();
                try {
                    priceData = JSON.parse(text);
                } catch (e) {
                    // If parsing fails, it's likely HTML error
                    // Extract title if possible or just show snippet
                    const snippet = text.substring(0, 100).replace(/\n/g, ' ');
                    throw new Error(`Invalid JSON response: ${snippet}`);
                }
            } catch (e: any) {
                throw new Error(`改价请求异常: ${e.message}`);
            }

            if (priceData.respCode !== '0' && priceData.respData?.optResult !== true) {
                throw new Error(priceData.respMsg || priceData.errorMsg || '改价失败');
            }
            addLog('改价成功');

            // 3. Create Order
            setStep(4);
            addLog('正在下单...');
            const bRes = await fetch(getApiUrl('buyers'));
            const buyers = await bRes.json();

            // Allow manual override for specific buyer if provided
            let buyer = specificBuyerId
                ? buyers.find((b: any) => b.id === specificBuyerId)
                : buyers.find((b: any) => b.status === '正常' || b.status === undefined);

            if (!item.infoId) throw new Error('商品信息不完整(infoId缺失)，请联系管理员刷新库存');

            // v1.9.4: Dynamically fetch address to ensure validity
            addLog('正在获取收货地址...');

            // Re-use headers
            const commonHeaders = {
                'Content-Type': 'application/json',
                'Referer': 'https://m.zhuanzhuan.com/',
                'Origin': 'https://m.zhuanzhuan.com',
                ...(buyer.csrfToken ? { 'Csrf-Token': buyer.csrfToken } : {})
            };

            const addrRes = await fetch(getApiUrl('proxy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: `https://app.zhuanzhuan.com/zz/transfer/getAllAddress?_t=${Date.now()}`,
                    method: 'GET',
                    cookie: buyer.cookie,
                    headers: commonHeaders
                })
            });

            let addressId = buyer.addressId || '';
            let addressList = [];

            try {
                const addrData = await addrRes.json();
                if (addrData.respCode === '0' && Array.isArray(addrData.respData)) {
                    addressList = addrData.respData;
                    if (addressList.length > 0) {
                        // Prefer default address, otherwise first
                        const defaultAddr = addressList.find((a: any) => a.isDefault === '1');
                        addressId = defaultAddr ? defaultAddr.id : addressList[0].id;
                        addLog(`使用地址: ${defaultAddr ? '默认' : '列表首个'} (ID: ${addressId})`);
                    }
                }
            } catch (e) {
                console.warn('Address fetch failed, falling back to cached ID', e);
            }

            if (!addressId) throw new Error('该买家账号未配置收货地址，无法下单');

            // Construct Complex Payload
            const productStr = JSON.stringify([{
                channelId: "",
                metric: "",
                payType: "0",
                serviceList: ["40"],
                infoNum: "1",
                infoId: item.infoId
            }]);

            const deliveryInfos = JSON.stringify([{
                infoId: item.infoId,
                deliveryInfo: {
                    deliveryMethodId: "1",
                    versionId: "0"
                }
            }]);

            const params = new URLSearchParams();
            params.append('apiVersion', 'V3_INSURANCE_SERVICE');
            params.append('payActionType', '1');
            params.append('mutiProduct', '1');
            params.append('payType', '0');
            params.append('supportCent', '1');
            params.append('addressId', addressId);
            params.append('productStr', productStr);
            params.append('buyerRemark', '');
            params.append('packIds', '[]');
            params.append('saleIds', '[]');
            params.append('deliveryInfos', deliveryInfos);
            params.append('tradeType', '0');
            params.append('captureState', '-1');
            params.append('infoId', item.infoId);
            params.append('infoNum', '');
            params.append('init_from', 'G1001_yxyl_diamond_5820_4'); // From demo log
            params.append('metric', '');
            params.append('requestOrigin', '');
            params.append('stagingId', '');
            params.append('whetherShowPosteriorQcStyle', '0');

            // Legacy/Redundant params just in case, or allow URLSearchParams to handle body
            // The Proxy expects `body` string in the JSON payload
            const formDataBody = params.toString();

            // Headers for Proxy Request
            const headers: any = {
                'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
                'Referer': 'https://m.zhuanzhuan.com/',
                'Origin': 'https://m.zhuanzhuan.com',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 zzVersion/11.21.5 zzT/16 zzDevice/1_141.0_3.0 zzApp/58ZhuanZhuan'
            };
            if (buyer.csrfToken) {
                headers['Csrf-Token'] = buyer.csrfToken;
            }

            const orderRes = await fetch(getApiUrl('proxy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: 'https://app.zhuanzhuan.com/zz/transfer/createOrder',
                    method: 'POST',
                    cookie: buyer.cookie,
                    body: formDataBody,
                    headers: headers
                })
            });

            // v1.8.9: Robust JSON parsing for Create Order
            let orderData;
            try {
                if (!orderRes.ok) {
                    throw new Error(`HTTP ${orderRes.status}`);
                }
                const text = await orderRes.text();
                try {
                    orderData = JSON.parse(text);
                } catch (e) {
                    const snippet = text.substring(0, 100).replace(/\n/g, ' ');
                    throw new Error(`Invalid JSON response: ${snippet}`);
                }
            } catch (e: any) {
                addLog(`下单请求未能解析: ${e.message}`);
                throw new Error('下单API响应异常');
            }

            // Enhanced Error Reporting for v1.9.3
            if (orderData.respCode !== '0') {
                console.error('Order Failed Details:', orderData);
                const errMsg = orderData.respMsg || orderData.errorMsg || '下单失败';
                // Include respCode to help diagnosis
                throw new Error(`下单被拒绝 [Code:${orderData.respCode}]: ${errMsg}`);
            }
            // v1.8.4: Create Link for scanning
            const zzOrderNo = orderData.respData.orderId;
            const payUrl = `https://app.zhuanzhuan.com/zzx/transfer/pay?orderId=${zzOrderNo}`;
            setPaymentLink(payUrl);

            const newOrder: Order = {
                id: `ZZPAY${Date.now()}`,
                orderNo: zzOrderNo,
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

            // Save Order to DB (Persistent merge on server)
            // v2.1.4: Include Lock Ticket for secondary validation
            const saveRes = await fetch(getApiUrl('add_order'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...newOrder,
                    lockTicket: lockTicket,
                    inventoryId: item.id,
                    accountId: item.accountId
                })
            });

            if (!saveRes.ok) {
                const sData = await saveRes.json().catch(() => ({}));
                if (saveRes.status === 409 && sData.code === 'LOCK_INVALID') {
                    throw new Error('库存锁定已失效（可能已被他人抢占），请刷新页面重试');
                }
                throw new Error(sData.error || '保存订单失败');
            }

            setOrder(newOrder);
            addLog(`下单成功! 订单号: ${newOrder.orderNo}`);
            setStep(5);

            // v2.0.0: Real-time Status Polling (instead of fake 2s delay)
            addLog('正在等待支付结果...');
            const pollStartTime = Date.now();
            const POLL_TIMEOUT = (settings?.validityDuration ? Number(settings.validityDuration) : 180) * 1000;

            let isPaid = false;
            while (Date.now() - pollStartTime < POLL_TIMEOUT) {
                await delay(4000); // Poll every 4s

                try {
                    const statusRes = await fetch(getApiUrl('proxy'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetUrl: `https://app.zhuanzhuan.com/zz/transfer/getOrder?mversion=3&orderId=${newOrder.orderNo}&abGroup=2`,
                            method: 'GET',
                            cookie: buyer.cookie,
                            headers: { 'Referer': 'https://m.zhuanzhuan.com/' }
                        })
                    });

                    if (statusRes.ok) {
                        const sData = await statusRes.json();
                        if (sData.respCode === '0') {
                            const statusStr = sData.respData?.status;
                            const statusInfo = sData.respData?.statusInfo;

                            // Code 3 is usually Paid/Success
                            if (statusStr === '3' || statusInfo?.includes('待发货') || statusInfo?.includes('已支付')) {
                                addLog('🎉 检测到支付成功！');
                                isPaid = true;
                                break;
                            } else if (statusStr === '19' || statusInfo?.includes('已取消')) {
                                throw new Error('订单已在外部系统取消');
                            }
                        }
                    }
                } catch (pollErr) {
                    console.warn('Polling error:', pollErr);
                }
            }

            if (isPaid) {
                setStep(6);
                // Update local order status if we have it
                setOrder(prev => prev ? { ...prev, status: OrderStatus.SUCCESS } : null);
            } else {
                addLog('⏳ 支付超时或未检测到结果');
                setStep(7); // Expired/Timeout state
                if (currentMatchedItem) releaseInventory(currentMatchedItem.id);
            }

            return newOrder;

        } catch (e: any) {
            const msg = typeof e === 'string' ? e : e.message;
            setError(msg);
            addLog(`❌ 进程错误: ${msg}`);
            if (currentMatchedItem) releaseInventory(currentMatchedItem.id);
            setStep(0);
            return null;
        }
    }, [addLog]); // Removed amount/onComplete from deps as they are passed to startPayment

    const cancelCurrentOrder = useCallback(async () => {
        if (matchedItem) {
            await releaseInventory(matchedItem.id);
        }
        setStep(0);
        setMatchedItem(null);
        setOrder(null);
        addLog('用户取消');
    }, [matchedItem]);

    return {
        startPayment,
        loading,
        logs,
        step,
        paymentLink,
        error,
        order,
        matchedItem,
        queueEndTime,
        freshAccounts,
        cancelCurrentOrder,
        orderCreatedAt: order?.createdAt,
        settings
    };
};
