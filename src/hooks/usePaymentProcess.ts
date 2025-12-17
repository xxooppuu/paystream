import { useState, useRef, useEffect } from 'react';
import { BuyerAccount, StoreAccount, InventoryItem, Order, OrderStatus } from '../types';
import { getApiUrl, PROXY_URL } from '../config';
import { performOrderCancellation, releaseInventory } from '../utils/orderActions';

export const usePaymentProcess = () => {
    // State
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [step, setStep] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderCreatedAt, setOrderCreatedAt] = useState<number | null>(null);
    const [currentBuyer, setCurrentBuyer] = useState<BuyerAccount | null>(null);
    const [lockedItem, setLockedItem] = useState<InventoryItem | null>(null);

    // Internal Data
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);
    const [accounts, setAccounts] = useState<StoreAccount[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);

    const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

    // Initial Data Load
    useEffect(() => {
        fetch(getApiUrl('buyers'))
            .then(res => res.json())
            .then(data => Array.isArray(data) && setBuyers(data));

        fetch(getApiUrl('shops'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setAccounts(data);
                    const allItems = data.flatMap((a: StoreAccount) => a.inventory || []);
                    setInventory(allItems);
                }
            });
    }, []);

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

    const saveOrderToBackend = async (
        status: OrderStatus,
        dataOverride?: { orderId?: string; buyer?: BuyerAccount; amount?: number; inventoryId?: string; accountId?: string }
    ) => {
        const actingOrderId = dataOverride?.orderId || orderId;
        const actingBuyer = dataOverride?.buyer || currentBuyer;

        if (!actingOrderId || !actingBuyer) return;

        try {
            // Get existing
            const getRes = await fetch(getApiUrl('orders'));
            let existing: Order[] = [];
            if (getRes.ok) existing = await getRes.json();

            // Construct Order (Partial - relies on existing or override)
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

            if (status === OrderStatus.SUCCESS) {
                addLog(`订单状态已更新为: ${status}`);
            }
        } catch (err) {
            console.error('Save order failed', err);
        }
    };

    const cancelCurrentOrder = async () => {
        if (!orderId || !currentBuyer) return;

        addLog('正在取消订单...');
        const success = await performOrderCancellation(orderId, currentBuyer.id);

        if (success) {
            addLog('订单已取消');
            setStep(0); // Reset or specific cancelled step?
            setError('订单已超时取消');
            await saveOrderToBackend(OrderStatus.CANCELLED);
            await releaseInventory(lockedItem?.id);
        } else {
            addLog('取消失败，请重试');
        }
    };

    const startPayment = async (amount: number, buyerId?: string) => {
        setLoading(true);
        setLogs([]);
        setError(null);
        setStep(1);
        setPaymentLink(null);
        setOrderId(null);
        setOrderCreatedAt(Date.now());

        try {
            // 1. Select Buyer
            let buyer: BuyerAccount | undefined;
            if (buyerId) {
                buyer = buyers.find(b => b.id === buyerId);
            } else {
                buyer = buyers[Math.floor(Math.random() * buyers.length)];
            }

            if (!buyer) throw new Error('未找到可用买家账号');
            setCurrentBuyer(buyer);
            addLog(`买家账号: ${buyer.remark}`);

            // 2. Refresh Inventory Logic
            const sRes = await fetch(getApiUrl('shops'));
            const freshAccounts: StoreAccount[] = await sRes.json();
            const freshInventory = freshAccounts.flatMap(a => a.inventory || []);
            setAccounts(freshAccounts);

            const idleItems = freshInventory.filter(i =>
                i.status.includes('出售') &&
                (i.internalStatus === 'idle' || !i.internalStatus)
            );

            if (idleItems.length === 0) throw new Error('库存不足 (无空闲商品)');

            const item = idleItems[Math.floor(Math.random() * idleItems.length)];
            setLockedItem(item);
            addLog(`匹配商品: ${item.parentTitle.substring(0, 15)}...`);

            // Lock Item
            const updatedAccounts = freshAccounts.map(a => ({
                ...a,
                inventory: a.inventory?.map(i => i.id === item.id ? { ...i, internalStatus: 'occupied' as const, lastMatchedTime: Date.now() } : i)
            }));
            await saveShops(updatedAccounts); // Persist

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
            const addrRes = await proxyRequest('https://app.zhuanzhuan.com/zz/transfer/getAllAddress', buyer.cookie);
            const addressId = addrRes.respData?.[0]?.id;
            if (!addressId) throw new Error('买家账号无收货地址');

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
            setOrderId(newOrderId);
            // Don't reset orderCreatedAt, keep the start time or use newOrderId creation time? 
            // Using startPayment time is stricter. User wants countdown from "Order Generated"?
            // "生成完付款订单的页面... 3分钟有效 -> 订单已生成 + 倒计时"
            // So countdown starts when order is created.
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

            addLog('核心支付链接获取成功!');
            setStep(5);

        } catch (e: any) {
            setError(e.message);
            addLog(`错误: ${e.message}`);
            // Revert Lock on Error
            await releaseInventory(lockedItem?.id);
        } finally {
            setLoading(false);
        }
    };

    // Polling Logic
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
        cancelCurrentOrder, // New Action
        loading,
        logs,
        step,
        error,
        paymentLink,
        orderId,
        orderCreatedAt, // New State
        buyers,
    };
};
