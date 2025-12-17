import React, { useState, useEffect } from 'react';
import { Save, Lock, Shield, CheckCircle, AlertTriangle } from 'lucide-react';
import { SystemSettings } from '../types';
import { getApiUrl } from '../config';

export const Settings: React.FC = () => {
    const [settings, setSettings] = useState<SystemSettings>({});
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await fetch(getApiUrl('settings'));
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
                if (data.password) setNewPassword(data.password); // Pre-fill for demo convenience
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setMsg(null);

        if (newPassword !== confirmPassword && confirmPassword !== '') {
            setMsg({ type: 'error', text: '两次输入的密码不一致' });
            return;
        }

        setLoading(true);
        try {
            const updatedSettings = { ...settings, password: newPassword };
            const res = await fetch(getApiUrl('settings'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedSettings)
            });

            if (res.ok) {
                setSettings(updatedSettings);
                setMsg({ type: 'success', text: '设置已保存' });
                // Optional: clear confirm password
                setConfirmPassword('');
            } else {
                throw new Error('Save failed');
            }
        } catch (error) {
            setMsg({ type: 'error', text: '保存失败，请检查后端服务' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">系统设置</h2>
                <p className="text-slate-500 text-sm">管理系统登录安全与其他配置</p>
            </div>

            {msg && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                    {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {msg.text}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-semibold text-slate-800">登录安全</h3>
                </div>

                <div className="p-6">
                    <form onSubmit={handleSave} className="space-y-4 max-w-lg">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">系统登录密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text" // Showing as text for convenience per typical "admin panel" logic, or password if preferred. Let's use text for admin convenience as requested implicitly by "setting info"
                                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                    placeholder="请输入管理密码"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    required
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">此密码用于登录系统管理后台</p>
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save className="w-4 h-4" />
                                <span>{loading ? '保存中...' : '保存设置'}</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
