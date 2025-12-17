import React, { useState, useEffect } from 'react';
import { usePaymentProcess } from '../hooks/usePaymentProcess';
import { PaymentPageConfig } from '../types';
import { getApiUrl } from '../config';
import { CreditCard, ShieldCheck, AlertCircle, Loader2, CheckCircle, Smartphone, QrCode } from 'lucide-react';

interface Props {
    pageId: string;
}

export const PublicPayment: React.FC<Props> = ({ pageId }) => {
    const [config, setConfig] = useState<PaymentPageConfig | null>(null);
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [amountInput, setAmountInput] = useState('');

    // Logic from the hook
    const { startPayment, loading, logs, step, error, paymentLink } = usePaymentProcess();

    useEffect(() => {
        // Fetch specific config
        // Since api.php returns all, we filter.
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

    // Auto-Correct Logic
    const getAdjustedAmount = (input: string): number => {
        const val = parseFloat(input);
        if (isNaN(val)) return 0;

        if (config?.channelId === 'default') {
            // "Subtract to end in 8"
            // If val ends in 8, keep it.
            // If val ends in 9, -1.
            // If val ends in 0, -2 (so prev ...8).
            // Logic: target = val - ((val - 8 + 10) % 10)
            const target = val - ((val - 8 + 10) % 10);
            return target > 0 ? target : 0;
        }
        return val;
    };

    const adjustedAmount = getAdjustedAmount(amountInput);

    const handlePay = () => {
        if (!config || adjustedAmount <= 0) return;
        if (config.minAmount && adjustedAmount < config.minAmount) return alert(`最小金额限制: ${config.minAmount}`);
        if (config.maxAmount && adjustedAmount > config.maxAmount) return alert(`最大金额限制: ${config.maxAmount}`);

        startPayment(adjustedAmount);
    };

    if (loadingConfig) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>;
    }

    if (!config) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-500 font-bold">无效的收款链接</div>;
    }

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
                        </>
                    )}

                    {step > 0 && step < 5 && (
                        <div className="text-center py-8 space-y-4">
                            <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto" />
                            <p className="text-slate-600 font-medium animate-pulse">
                                {step === 1 && "正在创建订单..."}
                                {step === 2 && "正在确认金额..."}
                                {step === 3 && "获取安全通道..."}
                                {step === 4 && "生成支付链接..."}
                            </p>
                            <div className="text-xs text-slate-400 h-4">{logs[0]}</div>
                        </div>
                    )}

                    {step === 5 && paymentLink && (
                        <div className="flex flex-col items-center animate-fade-in text-center">
                            <div className="bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 mb-6">
                                <CheckCircle className="w-4 h-4" />
                                <span>支付链接已生成 (3分钟有效)</span>
                            </div>

                            <div className="border-4 border-slate-900 p-2 rounded-xl mb-6">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(paymentLink)}`}
                                    alt="Payment QR"
                                    className="w-48 h-48"
                                />
                            </div>

                            <a
                                href={paymentLink}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold text-center flex items-center justify-center gap-2 transition-colors mb-4"
                            >
                                <Smartphone className="w-4 h-4" />
                                <span>点击跳转微信支付</span>
                            </a>

                            <p className="text-xs text-slate-400">如未自动跳转，请使用手机扫码支付</p>
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

                    {error && (
                        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm text-center">
                            {error}
                            <button onClick={() => window.location.reload()} className="block mx-auto mt-2 text-indigo-600 font-bold">重试</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
