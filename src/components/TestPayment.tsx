import React, { useState, useEffect } from 'react';
import {
    CreditCard,
    RefreshCw,
    CheckCircle,
    Clock,
    QrCode,
    Smartphone
} from 'lucide-react';
import { BuyerAccount } from '../types';
import { getApiUrl } from '../config';
import { usePaymentProcess } from '../hooks/usePaymentProcess';

export const TestPayment: React.FC = () => {
    // Config & Data
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);
    const [pullMode, setPullMode] = useState<'random' | 'specific'>('random');

    // UI Inputs
    const [amount, setAmount] = useState<string>('298');
    const [selectedBuyerId, setSelectedBuyerId] = useState<string>('');

    // Hook
    const {
        startPayment,
        loading,
        logs,
        step,
        paymentLink,
        error
    } = usePaymentProcess();

    // Load Data
    useEffect(() => {
        // Load buyers
        fetch(getApiUrl('buyers'))
            .then(res => res.json())
            .then(data => Array.isArray(data) && setBuyers(data));

        // Load Settings for local UI toggle (hook handles internal logic)
        fetch(getApiUrl('settings'))
            .then(res => res.json())
            .then(data => {
                if (data.pullMode) setPullMode(data.pullMode);
            });
    }, []);

    const handleGeneratePayment = () => {
        const val = parseFloat(amount);
        if (isNaN(val) || val <= 0) return alert('请输入有效金额');

        // If specific mode in UI, pass selected ID. Otherwise pass undefined to let hook decide.
        // Note: The hook respects server settings. If server says 'specific' and we pass nothing, hook uses server setting.
        // But here we want to allow manual override for testing? 
        // Or strictly follow UI? 
        // Let's pass selectedBuyerId if pullMode is specific.
        startPayment(val, (pullMode === 'specific' && selectedBuyerId) ? selectedBuyerId : undefined);
    };

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
                    <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 h-64 overflow-y-auto space-y-1">
                        {logs.length === 0 && !error && <span className="text-slate-600">等待操作...</span>}
                        {logs.map((log, i) => <div key={i}>{log}</div>)}
                        {error && <div className="text-red-400 font-bold mt-2">错误: {error}</div>}
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
                                <span>支付链接已生成</span>
                            </div>

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
