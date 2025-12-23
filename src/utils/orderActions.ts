import { getApiUrl, PROXY_URL } from '../config';

export const performOrderCancellation = async (orderId: string, buyerId: string): Promise<boolean> => {
    if (!orderId || !buyerId) return false;

    try {
        // 1. Get Buyer Cookie
        const bRes = await fetch(getApiUrl('buyers'));
        if (!bRes.ok) return false;
        const buyers: any[] = await bRes.json();
        const buyer = buyers.find((b: any) => b.id === buyerId);
        if (!buyer) return false;

        // 2. Call Cancel API (Proxy)
        const proxyRes = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: 'https://app.zhuanzhuan.com/zz/transfer/cancelOrder',
                method: 'POST',
                cookie: buyer.cookie,
                body: `cancelReason=不想要了&subCancelReason=&orderId=${orderId}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
                    'Referer': 'https://m.zhuanzhuan.com/'
                }
            })
        });

        const apiRes = await proxyRes.json();
        if (apiRes.respCode === '0' || apiRes.respData?.statusInfo === '已取消') {
            return true;
        }
        return false;
    } catch (e) {
        console.error('Cancel failed', e);
        return false;
    }
};

export const releaseInventory = async (inventoryId: string | undefined, accountId?: string) => {
    if (!inventoryId) return;

    try {
        // v2.1.6: Atomic Release via Backend with accountId for precision
        await fetch(getApiUrl('release_inventory'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: inventoryId,
                accountId: accountId
            })
        });
        console.log(`[Atomic] Inventory ${inventoryId} (Acc: ${accountId}) released.`);
    } catch (e) {
        console.error("Failed to release inventory", e);
    }
};
