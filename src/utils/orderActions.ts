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

export const releaseInventory = async (inventoryId: string, accountId?: string, lockTicket?: string | null) => {
    try {
        const res = await fetch(getApiUrl('admin_release_inventory'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: inventoryId,
                accountId, // Optional, for logging/context
                lockTicket // v2.2.68: Safe Release Ticket
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '由服务器拒绝释放');
        }
        return await res.json();
    } catch (error) {
        console.error("Release failed", error);
        throw error;
    }
};
