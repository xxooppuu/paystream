import React, { useState, useEffect } from 'react';
import { ShieldCheck, Database, ArrowRight, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { getApiUrl } from '../config';

interface SetupWizardProps {
    onComplete: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState(1);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isInstalling, setIsInstalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [installResult, setInstallResult] = useState<any>(null);

    const handleInstall = async () => {
        if (password !== confirmPassword) {
            setError('两次输入的密码不一致');
            return;
        }
        if (password.length < 6) {
            setError('密码长度至少为 6 位');
            return;
        }

        setIsInstalling(true);
        setError(null);

        try {
            const res = await fetch(getApiUrl('setup'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (data.success) {
                setInstallResult(data);
                setStep(3);
            } else {
                setError(data.error || '安装失败，请检查控制台');
            }
        } catch (e) {
            setError('网络请求失败');
        } finally {
            setIsInstalling(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-[#1e293b] border border-[#334155] rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-center text-white">
                    <div className="inline-flex items-center justify-center p-3 bg-white/10 rounded-xl mb-4">
                        <ShieldCheck className="w-10 h-10" />
                    </div>
                    <h1 className="text-2xl font-bold">PayStream v2.1.8</h1>
                    <p className="text-blue-100 mt-2">系统初始化向导</p>
                </div>

                <div className="p-8">
                    {/* Progress Steps */}
                    <div className="flex justify-between mb-8">
                        {[1, 2, 3].map((s) => (
                            <div key={s} className="flex items-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= s ? 'bg-blue-600 text-white' : 'bg-[#334155] text-gray-400'
                                    }`}>
                                    {step > s ? <CheckCircle2 className="w-5 h-5" /> : s}
                                </div>
                                {s < 3 && <div className={`w-12 h-0.5 mx-2 ${step > s ? 'bg-blue-600' : 'bg-[#334155]'}`} />}
                            </div>
                        ))}
                    </div>

                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="text-center">
                                <Database className="w-12 h-12 text-blue-400 mx-auto mb-4" />
                                <h2 className="text-xl font-semibold text-white">欢迎使用 PayStream</h2>
                                <p className="text-gray-400 mt-2 text-sm leading-relaxed">
                                    系统检测到这是您首次安装或正在执行数据库升级。
                                    我们将为您自动创建 SQLite 数据库，并迁移现存的订单、店铺及设置数据。
                                </p>
                            </div>
                            <button
                                onClick={() => setStep(2)}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 group"
                            >
                                开始配置 <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <h2 className="text-xl font-semibold text-white">设置管理员密码</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">初始密码</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="请输入管理员密码"
                                        className="w-full bg-[#334155] border border-[#475569] text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">确认密码</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="请再次输入密码"
                                        className="w-full bg-[#334155] border border-[#475569] text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                onClick={handleInstall}
                                disabled={isInstalling}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                            >
                                {isInstalling ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        正在初始化系统...
                                    </>
                                ) : (
                                    '确认并安装'
                                )}
                            </button>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/30">
                                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                                </div>
                                <h2 className="text-xl font-semibold text-white">系统已就绪!</h2>
                                <p className="text-gray-400 mt-2 text-sm">
                                    数据库已成功初始化，所有数据迁移完毕。
                                </p>
                            </div>

                            <div className="bg-[#0f172a] rounded-xl p-4 text-xs font-mono text-blue-300 space-y-1 max-h-32 overflow-y-auto border border-[#334155]">
                                <div className="text-gray-500 mb-1 uppercase tracking-wider">迁移报告:</div>
                                {installResult?.migrated?.map((item: string) => (
                                    <div key={item}>[OK] Migrated {item} data successfully.</div>
                                ))}
                                {!installResult?.migrated?.length && <div>[OK] Clean installation. No legacy data found.</div>}
                            </div>

                            <button
                                onClick={onComplete}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-green-900/20"
                            >
                                进入后台
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
