import React, { useState, useEffect } from 'react';
import { usePaymentProcess } from '../hooks/usePaymentProcess';
import { PaymentPageConfig } from '../types';
import { getApiUrl } from '../config';
import { CreditCard, ShieldCheck, AlertCircle, Loader2, CheckCircle, Smartphone, Clock, XCircle, Hourglass } from 'lucide-react';

interface Props {
    pageId: string;
}

export const PublicPayment: React.FC<Props> = ({ pageId }) => {
    const [config, setConfig] = useState<PaymentPageConfig | null>(null);
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [amountInput, setAmountInput] = useState('');
    const [validityDuration, setValidityDuration] = useState(180); // Default 3 mins
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [isWeChat, setIsWeChat] = useState(false);
    const [visitorIp, setVisitorIp] = useState<string | null>(null);
    const [clockDrift, setClockDrift] = useState(0);
    const [ipLimitError, setIpLimitError] = useState<string | null>(null);
    const [queueTimeLeft, setQueueTimeLeft] = useState<number | null>(null);
    const [ipUsage, setIpUsage] = useState<string | null>(null);
    const [finalStep, setFinalStep] = useState<number | null>(null); // v2.2.64: Persist final error state

    useEffect(() => {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.match(/micromessenger/i)) {
            setIsWeChat(true);
        }
        // Fetch IP and server time
        fetch(getApiUrl('get_ip'))
            .then(res => res.json())
            .then(data => {
                setVisitorIp(data.ip);
                if (data.serverTime) {
                    setClockDrift(data.serverTime - Date.now());
                }
            })
            .catch(console.error);
    }, []);

    // Logic from the hook
    const { startPayment, cancelCurrentOrder, loading, logs, step, error, paymentLink, orderCreatedAt, queueEndTime, settings, internalOrderId, queuePosition, amount, matchedTime, order } = usePaymentProcess();

    // v2.2.80: Track logged orders to prevent duplicates (and ensure logging happens immediately upon order creation)
    const orderLoggedRef = React.useRef<string | null>(null);
    useEffect(() => {
        if (order && order.orderNo && orderLoggedRef.current !== order.orderNo) {
            orderLoggedRef.current = order.orderNo;
            saveIpLog().then(() => checkIpLimit(true));
        }
    }, [order]);

    useEffect(() => {
        // Fetch specific config
        fetch(getApiUrl('payment_pages'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const found = data.find((p: any) => p.id === pageId);
                    if (found) {
                        setConfig(found);
                        // v2.2.114: Sync browser tab title
                        document.title = found.title || '安全支付收银台';
                    } else {
                        setConfig(null);
                    }
                }
            })
            .catch(console.error)
            .finally(() => setLoadingConfig(false));
    }, [pageId]);

    // Countdown Logic
    useEffect(() => {
        const currentStep = finalStep || step;
        if (currentStep === 5 && orderCreatedAt && settings?.validityDuration) {
            const duration = Number(settings.validityDuration);
            const timer = setInterval(() => {
                const now = Date.now();
                // v2.2.70: Use matchedTime (start of lock) instead of createdAt (start of queue)
                const startTime = matchedTime || new Date(orderCreatedAt || now).getTime();
                const elapsedSeconds = Math.floor((now - startTime) / 1000);
                const remaining = duration - elapsedSeconds;

                if (remaining <= 0) {
                    setTimeLeft(0);
                    clearInterval(timer);
                    cancelCurrentOrder(true);
                } else {
                    setTimeLeft(remaining);
                }
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [step, finalStep, orderCreatedAt, settings?.validityDuration, matchedTime]);

    useEffect(() => {
        if (queueEndTime) {
            const timer = setInterval(() => {
                const now = Date.now();
                const remaining = Math.max(0, Math.ceil((queueEndTime - now) / 1000));
                setQueueTimeLeft(remaining);
                if (remaining <= 0) clearInterval(timer);
            }, 500);
            return () => clearInterval(timer);
        } else {
            setQueueTimeLeft(null);
        }
    }, [queueEndTime]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Auto-Correct Logic
    const getAdjustedAmount = (input: string): number => {
        const val = parseFloat(input);
        if (isNaN(val)) return 0;

        if (config?.channelId === 'default') {
            const target = val - ((val - 8 + 10) % 10);
            return target > 0 ? target : 0;
        }
        return val;
    };

    const adjustedAmount = getAdjustedAmount(amountInput);

    const checkIpLimit = async (silent = false) => {
        if (!config || !visitorIp || !config.ipLimitTime || !config.ipLimitCount) return true;

        // Check Whitelist
        if (config.ipWhitelist) {
            const whitelist = config.ipWhitelist.split(',').map(i => i.trim());
            if (whitelist.includes(visitorIp)) return true;
        }

        try {
            const res = await fetch(getApiUrl('ip_logs') + `&_t=${Date.now()}`);
            const allLogs = res.ok ? await res.json() : [];
            // v2.2.75: Fix schema mismatch - DB stores pageId in 'type' column
            const pageLogs = Array.isArray(allLogs) ? allLogs.filter((l: any) => l.ip === visitorIp && l.type === pageId) : [];

            const now = Date.now() + clockDrift;
            const windowMs = config.ipLimitTime * 60 * 60 * 1000;
            const recentLogs = pageLogs.filter((l: any) => {
                const diff = now - l.timestamp;
                return diff >= 0 && diff < windowMs; // Ignore future logs, only count past within window
            });

            // Update display info
            const count = recentLogs.length;
            const remaining = Math.max(0, config.ipLimitCount - count);
            setIpUsage(`${config.ipLimitTime}小时内已拉单 ${count}/${config.ipLimitCount} 次，还剩 ${remaining} 次`);

            if (!silent && count >= config.ipLimitCount) {
                // Find when the oldest log expires
                const oldest = Math.min(...recentLogs.map((l: any) => l.timestamp));
                const nextAvail = oldest + windowMs;
                const nextDate = new Date(nextAvail);
                const timeStr = `${nextDate.getHours().toString().padStart(2, '0')}:${nextDate.getMinutes().toString().padStart(2, '0')}`;

                setIpLimitError(`每隔${config.ipLimitTime}小时可提交订单${config.ipLimitCount}次，您已超出限制。${timeStr}后即可重新付款。`);
                return false;
            }
        } catch (e) {
            console.error("Failed to check IP logs", e);
        }
        return true;
    };

    // Auto-refresh IP usage on load
    useEffect(() => {
        if (config && visitorIp) {
            checkIpLimit();
        }
    }, [config, visitorIp]);

    const saveIpLog = async () => {
        if (!visitorIp) return;
        try {
            await fetch(getApiUrl('add_ip_log'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId })
            });
        } catch (e) {
            console.error("Failed to save IP log", e);
        }
    };

    const handlePay = async () => {
        if (!config || adjustedAmount <= 0) return;
        if (config.minAmount && adjustedAmount < config.minAmount) return alert(`最小金额限制: ${config.minAmount}`);
        if (config.maxAmount && adjustedAmount > config.maxAmount) return alert(`最大金额限制: ${config.maxAmount}`);

        // Check Business Status
        if (config.isOpen === false) {
            return alert('商家目前休息中，请稍后再试');
        }

        // Check IP Limit
        const canPay = await checkIpLimit();
        if (!canPay) return;

        try {
            const info = await startPayment(adjustedAmount);
            // v2.2.80: IP Logging moved to useEffect to avoid blocking on payment polling
            if (info) {
                // Success
            }
        } catch (e) {
            // Error handled in hook
        }
    };

    // Helper Arrow Component
    const ArrowUpRight = () => (
        <svg width="60" height="60" viewBox="0 0 100 100" className="absolute top-4 right-6 text-white animate-bounce" style={{ filter: 'drop-shadow(0 0 5px rgba(0,0,0,0.5))' }}>
            <path d="M 10 90 Q 50 10 80 20" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="5,5" />
            <path d="M 80 20 L 70 30 M 80 20 L 70 10" stroke="currentColor" strokeWidth="4" fill="none" />
        </svg>
    );

    if (loadingConfig) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>;
    }

    if (!config) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-500 font-bold">无效的收款链接</div>;
    }

    // v2.2.84: Handle Rest Mode (Store Closed) - Bypass WeChat Redirect
    // Check for explicit false or numeric 0
    if (!config.isOpen || config.isOpen === 0) {
        return (
            <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
                <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-amber-500 h-2 w-full" />
                    <div className="p-8 text-center">
                        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500">
                            <Clock className="w-10 h-10" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">商家休息中</h2>
                        <p className="text-slate-500 mb-6">商家当前暂不营业，请稍后再来。</p>

                        {config.notice && (
                            <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 text-left">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="font-bold text-amber-800 text-sm mb-1">商家公告</h4>
                                        <p className="text-sm text-amber-700 leading-relaxed whitespace-pre-wrap">{config.notice}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="mt-8 text-xs text-slate-400">
                            System Rest Mode • {pageId}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isWeChat) {
        return (
            <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col items-center justify-center p-6 text-white">
                <ArrowUpRight />
                <div className="bg-white/10 p-6 rounded-2xl backdrop-blur-sm text-center max-w-sm w-full border border-white/20 shadow-2xl">
                    <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                        <Smartphone className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold mb-4">请在浏览器打开</h2>
                    <p className="text-slate-200 mb-8 leading-relaxed">
                        由于微信限制，无法直接完成支付。
                        <br />
                        请点击右上角 <span className="font-bold text-white mx-1 text-xl">···</span> 按钮
                        <br />
                        选择 <span className="font-bold text-yellow-400">在浏览器打开</span> 以继续。
                    </p>
                    <div className="flex items-center justify-center space-x-2 text-sm text-slate-400 bg-black/20 py-3 rounded-lg">
                        <AlertCircle className="w-4 h-4" />
                        <span>safari / chrome / default browser</span>
                    </div>
                </div>
            </div>
        );
    }

    const InfoBox = () => (
        config.notice ? (
            <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm leading-relaxed border border-blue-100 mt-6 text-left">
                <div className="font-bold flex items-center gap-2 mb-1 text-blue-900">
                    <AlertCircle className="w-4 h-4" />
                    <span>注意事项</span>
                </div>
                <p className="whitespace-pre-wrap">{config.notice}</p>
            </div>
        ) : null
    );

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden relative">
                {/* Header - Improved v1.6.4 Aesthetics */}
                <div className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 p-10 text-white text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-white/5 transform -skew-x-12"></div>
                    <div className="relative z-10 flex flex-col items-center">
                        <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-3 backdrop-blur-md border border-white/30 shadow-xl">
                            <ShieldCheck className="w-7 h-7 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">{config?.title || '安全支付收银台'}</h1>
                        <p className="text-indigo-100/70 text-sm mt-1 font-medium">PayStream Secure Checkout</p>
                    </div>
                </div>

                {/* Content Area */}
                <div className="p-8">
                    {(() => {
                        const currentStep = finalStep || step;

                        // v2.2.64: Emergency/Admin Cancelled State
                        if (currentStep === 8) {
                            return (
                                <div className="text-center py-12 space-y-6 animate-fade-in">
                                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600">
                                        <XCircle className="w-10 h-10" />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-xl font-bold text-slate-800">该订单已失效</h3>
                                        <p className="text-slate-500 text-sm">订单已被后台取消，或匹配商品已失效</p>
                                    </div>
                                    <button onClick={() => window.location.reload()} className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold">
                                        返回主页
                                    </button>
                                </div>
                            );
                        }

                        // 1. 商家休息中 (最高优先级)
                        if (!config.isOpen || config.isOpen === 0) {
                            return (
                                <div className="text-center py-12 space-y-6 animate-fade-in">
                                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-400">
                                        <Hourglass className="w-10 h-10" />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-xl font-bold text-slate-800">商家休息中</h3>
                                        <p className="text-slate-500">很抱歉，当前暂不接受新订单</p>
                                    </div>
                                    {config.notice && (
                                        <div className="bg-amber-50 text-amber-800 p-4 rounded-xl text-sm border border-amber-100 text-left">
                                            <div className="font-bold flex items-center gap-2 mb-1">
                                                <AlertCircle className="w-4 h-4" />
                                                <span>重要通知</span>
                                            </div>
                                            <p className="whitespace-pre-wrap">{config.notice}</p>
                                        </div>
                                    )}
                                    <button onClick={() => window.location.reload()} className="text-indigo-600 font-bold text-sm mt-4 hover:underline">
                                        点击刷新试试
                                    </button>
                                </div>
                            );
                        }

                        // 2. IP 限制 (仅在订单生成前生效)
                        if (currentStep === 0 && !loading && ipLimitError) {
                            return (
                                <div className="text-center py-12 space-y-6 animate-fade-in">
                                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500">
                                        <Clock className="w-8 h-8" />
                                    </div>
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-bold text-slate-800">付款频率超限</h3>
                                        <p className="text-slate-600 text-sm bg-red-50 p-4 rounded-xl border border-red-100 leading-relaxed">
                                            {ipLimitError}
                                        </p>
                                        <button onClick={() => setIpLimitError(null)} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold">
                                            我知道了
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        // 3. 错误状态 (非超时且非 IP 限制)
                        if (error && currentStep !== 7 && !ipLimitError) {
                            return (
                                <div className="text-center py-8">
                                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                                        <XCircle className="w-8 h-8" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-2">订单提交失败</h3>
                                    <p className="text-slate-500 text-sm mb-6">当前系统繁忙，请稍后重试</p>
                                    <button onClick={() => window.location.reload()} className="text-indigo-600 font-bold hover:underline">
                                        返回重新下单
                                    </button>
                                </div>
                            );
                        }

                        // 4. 不同步骤渲染
                        switch (step) {
                            case 0:
                                return (
                                    <div className="space-y-6 animate-fade-in">
                                        <label className="block text-sm font-medium text-slate-700 mb-2">请输入支付金额</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl font-bold">¥</span>
                                            <input
                                                type="number"
                                                className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-2xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-300"
                                                placeholder="0.00"
                                                value={amountInput}
                                                onChange={e => setAmountInput(e.target.value)}
                                            />
                                        </div>

                                        {amountInput && parseFloat(amountInput) > 0 && adjustedAmount !== parseFloat(amountInput) && (
                                            <div className="mt-3 flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg text-sm">
                                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                                <span>
                                                    根据通道规则，实际支付金额将调整为 <span className="font-bold">¥{adjustedAmount}</span>
                                                </span>
                                            </div>
                                        )}

                                        <button
                                            onClick={handlePay}
                                            disabled={adjustedAmount <= 0 || loading}
                                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                                            <span>立即支付 ¥{adjustedAmount > 0 ? adjustedAmount : '0.00'}</span>
                                        </button>
                                        <InfoBox />
                                    </div>
                                );

                            case 0.5:
                                if (currentStep === 8) return null; // Let the safety catch it
                                return (
                                    <div className="text-center py-12 space-y-6 animate-fade-in">
                                        <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-amber-800 animate-pulse-slow relative overflow-hidden">
                                            <div className="flex flex-col items-center gap-3 relative z-10">
                                                <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                                                <div>
                                                    <h3 className="font-bold text-lg mb-1">正在排队，请稍后</h3>
                                                    {internalOrderId && <p className="text-[10px] opacity-60 font-mono">单号: {internalOrderId}</p>}
                                                </div>
                                            </div>
                                            <div className="mt-4 bg-white/50 rounded-xl p-3 text-center">
                                                <span className="text-sm font-bold text-amber-900 block">目前排位: 第 {queuePosition || '?'} 位</span>
                                            </div>
                                            {/* Progress Bar Aesthetic */}
                                            <div className="w-full bg-black/5 rounded-full h-1 mt-4 overflow-hidden mx-auto max-w-[120px]">
                                                <div className="bg-amber-500 h-full rounded-full animate-progress-indeterminate"></div>
                                            </div>
                                        </div>
                                    </div>
                                );

                            case 1:
                            case 2:
                            case 3:
                            case 4:
                                // v2.2.122: Progress Mapping
                                const progress = step === 1 ? 35 : (step === 2 ? 45 : (step === 3 ? 65 : 85));
                                return (
                                    <div className="text-center py-12 space-y-8 animate-fade-in">
                                        <div className="space-y-4">
                                            <h3 className="font-bold text-xl text-slate-800">正在生成订单 请勿离开！</h3>
                                            <p className="text-sm text-slate-500">正在为您安全匹配商品，请稍候...</p>
                                        </div>

                                        <div className="relative pt-1">
                                            <div className="flex mb-2 items-center justify-between">
                                                <div>
                                                    <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-indigo-600 bg-indigo-200">
                                                        系统处理中
                                                    </span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-xs font-semibold inline-block text-indigo-600">
                                                        {progress}%
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="overflow-hidden h-3 mb-4 text-xs flex rounded-full bg-indigo-100 shadow-inner">
                                                <div
                                                    style={{ width: `${progress}%` }}
                                                    className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700 ease-out relative"
                                                >
                                                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                                            <ShieldCheck className="w-4 h-4 text-green-500" />
                                            <span>PayStream 银行级加密传输</span>
                                        </div>
                                    </div>
                                );

                            case 5:
                                return paymentLink ? (
                                    <div className="flex flex-col items-center animate-fade-in text-center">
                                        {(amount > 0) && (
                                            <div className="mb-6 w-full bg-slate-50 rounded-xl p-4 border border-slate-100">
                                                <div className="text-3xl font-bold text-slate-800 mb-1">¥ {amount}</div>
                                                <div className="text-xs text-slate-400 font-mono">内部订单号: {internalOrderId}</div>
                                            </div>
                                        )}
                                        <div className="mb-8 flex flex-col items-center">
                                            <div className="text-4xl font-mono font-bold text-slate-800 mb-2">
                                                {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
                                            </div>
                                            <div className="flex items-center gap-2 text-indigo-600 font-medium bg-indigo-50 px-3 py-1 rounded-full text-sm">
                                                <Clock className="w-4 h-4" />
                                                <span>订单已生成，请尽快支付</span>
                                            </div>
                                        </div>
                                        <a
                                            href={paymentLink}
                                            onClick={(e) => {
                                                // v2.2.85: Force navigation for better mobile support
                                                e.preventDefault();
                                                window.location.href = paymentLink;
                                            }}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold text-lg text-center flex items-center justify-center gap-2 transition-colors mb-8 shadow-lg shadow-green-200 cursor-pointer active:scale-95 transform duration-100"
                                        >
                                            <Smartphone className="w-5 h-5" />
                                            <span>点击跳转微信支付</span>
                                        </a>
                                        <InfoBox />
                                    </div>
                                ) : null;

                            case 6:
                                return (
                                    <div className="text-center py-12">
                                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600">
                                            <CheckCircle className="w-10 h-10" />
                                        </div>
                                        <h2 className="text-2xl font-bold text-slate-800">支付成功</h2>
                                        <p className="text-slate-500 mt-2">订单已完成，感谢您的支付。</p>
                                    </div>
                                );

                            case 7:
                                return (
                                    <div className="text-center py-12">
                                        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-600">
                                            <Clock className="w-10 h-10" />
                                        </div>
                                        <h2 className="text-2xl font-bold text-slate-800">支付已超时</h2>
                                        <p className="text-slate-500 mt-2">订单已过期，请重新发起支付。</p>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="mt-8 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-colors"
                                        >
                                            刷新页面重新下单
                                        </button>
                                    </div>
                                );

                            case 8:
                                return (
                                    <div className="text-center py-12 space-y-6">
                                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500">
                                            <XCircle className="w-10 h-10" />
                                        </div>
                                        <h2 className="text-2xl font-bold text-slate-800">订单已关闭</h2>
                                        <p className="text-slate-500 mt-2">{error || '由于超时或手动操作，该排队订单已失效。'}</p>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="mt-8 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-colors"
                                        >
                                            返回重新下单
                                        </button>
                                    </div>
                                );

                            default:
                                return null;
                        }
                    })()}

                    <div className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-slate-500 pointer-events-none space-y-1">
                        {visitorIp && (
                            <div>
                                IP: {visitorIp} {ipUsage ? ` / ${ipUsage}` : ''} / SYNC: {Math.abs(clockDrift) > 1000 ? 'ADJ' : 'OK'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
