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
    const [queueTimeLeft, setQueueTimeLeft] = useState<number | null>(null);
    const [orderInfo, setOrderInfo] = useState<{ shortId: string, amount: number } | null>(null);

    // Logic from the hook
    const { startPayment, cancelCurrentOrder, loading, logs, step, error, paymentLink, orderCreatedAt, queueEndTime, settings } = usePaymentProcess();

    useEffect(() => {
        // Fetch specific config
        fetch(getApiUrl('payment_pages'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const found = data.find((p: any) => p.id === pageId);
                    setConfig(found || null);
                }
            })
            .catch(console.error)
            .finally(() => setLoadingConfig(false));
    }, [pageId]);

    // Countdown Logic
    useEffect(() => {
        if (step === 5 && orderCreatedAt && settings?.validityDuration) {
            const duration = Number(settings.validityDuration);
            const timer = setInterval(() => {
                const now = Date.now();
                const elapsedSeconds = Math.floor((now - orderCreatedAt) / 1000);
                const remaining = duration - elapsedSeconds;

                if (remaining <= 0) {
                    setTimeLeft(0);
                    clearInterval(timer);
                    cancelCurrentOrder();
                } else {
                    setTimeLeft(remaining);
                }
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [step, orderCreatedAt, settings?.validityDuration]);

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

    const handlePay = async () => {
        if (!config || adjustedAmount <= 0) return;
        if (config.minAmount && adjustedAmount < config.minAmount) return alert(`最小金额限制: ${config.minAmount}`);
        if (config.maxAmount && adjustedAmount > config.maxAmount) return alert(`最大金额限制: ${config.maxAmount}`);

        try {
            const info = await startPayment(adjustedAmount);
            if (info) setOrderInfo(info);
        } catch (e) {
            // Error handled in hook
        }
    };

    if (loadingConfig) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>;
    }

    if (!config) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-500 font-bold">无效的收款链接</div>;
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
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="bg-indigo-600 p-6 text-center text-white">
                    <h1 className="text-xl font-bold">{config.title}</h1>
                    <p className="text-indigo-200 text-sm mt-1">安全支付收银台</p>
                </div>

                <div className="p-8 space-y-6">
                    {step === 0 && (
                        <>
                            <div>
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
                            </div>

                            <button
                                onClick={handlePay}
                                disabled={adjustedAmount <= 0 || loading}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                                <span>立即支付 ¥{adjustedAmount > 0 ? adjustedAmount : '0.00'}</span>
                            </button>

                            <InfoBox />
                        </>
                    )}

                    {step === 0.5 && (
                        <div className="text-center py-12 space-y-6 animate-fade-in">
                            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-600 animate-pulse">
                                <Hourglass className="w-10 h-10" />
                            </div>
                            <div className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800">当前订单过多，排队中...</h3>
                                <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-xl border border-amber-100 max-w-xs mx-auto">
                                    <p className="text-sm">系统正在努力匹配空闲商品</p>
                                    <p className="text-xs mt-1 text-amber-600">预计等待时间: {queueTimeLeft !== null ? `${queueTimeLeft}秒` : '计算中...'}</p>
                                </div>

                                <div className="w-full bg-slate-100 rounded-full h-2 mt-4 overflow-hidden">
                                    <div className="bg-amber-500 h-full rounded-full animate-progress-indeterminate"></div>
                                </div>
                                <p className="text-xs text-slate-400">一旦有空闲将自动为您匹配</p>
                            </div>
                        </div>
                    )}

                    {step > 0 && step < 5 && (
                        <div className="text-center py-12 space-y-6">
                            <Loader2 className="w-16 h-16 animate-spin text-indigo-600 mx-auto" />
                            <div className="space-y-2">
                                <h3 className="text-xl font-medium text-slate-800">正在生成订单</h3>
                                <p className="text-slate-500">请稍候，由于金额校验安全需要，预计需要 3-5 秒...</p>
                            </div>
                        </div>
                    )}

                    {step === 5 && paymentLink && (
                        <div className="flex flex-col items-center animate-fade-in text-center">

                            {/* Order Info */}
                            {orderInfo && (
                                <div className="mb-6 w-full bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="text-3xl font-bold text-slate-800 mb-1">¥ {orderInfo.amount}</div>
                                    <div className="text-xs text-slate-400 font-mono">订单号: {orderInfo.shortId}</div>
                                </div>
                            )}

                            {/* Timer */}
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
                                target="_blank"
                                rel="noreferrer"
                                className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold text-lg text-center flex items-center justify-center gap-2 transition-colors mb-8 shadow-lg shadow-green-200"
                            >
                                <Smartphone className="w-5 h-5" />
                                <span>点击跳转微信支付</span>
                            </a>

                            <InfoBox />
                        </div>
                    )}

                    {step === 6 && (
                        <div className="text-center py-12">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600">
                                <CheckCircle className="w-10 h-10" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800">支付成功</h2>
                            <p className="text-slate-500 mt-2">订单已完成，感谢您的支付。</p>
                        </div>
                    )}

                    {step === 7 && (
                        <div className="text-center py-12 space-y-6">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-400">
                                <Clock className="w-10 h-10" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800">订单已过期</h2>
                            <p className="text-slate-500 mt-2">支付时间已超长，订单已自动取消。</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="mt-8 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-colors"
                            >
                                刷新页面重新下单
                            </button>
                        </div>
                    )}

                    {error && step !== 7 && (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                                <XCircle className="w-8 h-8" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 mb-2">订单提交失败</h3>
                            <p className="text-slate-500 text-sm mb-6">当前系统繁忙，请稍后重试</p>
                            {/* Detailed error hidden from UI but logged: {error} */}

                            <button onClick={() => window.location.reload()} className="text-indigo-600 font-bold hover:underline">
                                返回重新下单
                            </button>
                        </div>
                    )}

                    <div className="absolute bottom-4 left-0 right-0 text-center text-xs text-slate-300 pointer-events-none">
                        PayStream v1.5.7
                    </div>
                </div>
            </div>
        </div>
    );
};
