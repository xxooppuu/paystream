import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, User, Settings, Info } from 'lucide-react';
import { BuyerAccount } from '../types';
import { getApiUrl } from '../config';

export const PaymentConfig: React.FC = () => {
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);

    // New Buyer Form
    const [newRemark, setNewRemark] = useState('');
    const [newCookie, setNewCookie] = useState('');

    // Config State (Saved to localStorage for now as simple preference, or we could add to a config file)
    const [pullMode, setPullMode] = useState<'specific' | 'random'>(localStorage.getItem('pullMode') as any || 'random');
    const [productMode, setProductMode] = useState<'shop' | 'random'>(localStorage.getItem('productMode') as any || 'random');
    const [validityDuration, setValidityDuration] = useState<number>(180); // Default 3 mins

    useEffect(() => {
        // Fetch System Settings
        fetch(getApiUrl('settings'))
            .then(res => res.json())
            .then(data => {
                if (data.validityDuration) setValidityDuration(Number(data.validityDuration));
            })
            .catch(console.error);

        fetch(getApiUrl('buyers'))
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setBuyers(data);
            })
            .catch(err => console.error('Failed to load buyers', err));
    }, []);

    const saveBuyers = async (newBuyers: BuyerAccount[]) => {
        try {
            await fetch(getApiUrl('buyers'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newBuyers)
            });
        } catch (err) {
            console.error('Failed to save buyers', err);
        }
    };

    const handleAddBuyer = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRemark || !newCookie) return;

        const newBuyer: BuyerAccount = {
            id: Date.now().toString(),
            remark: newRemark,
            cookie: newCookie.trim(),
            totalOrders: 0,
            successOrders: 0
        };

        const updated = [...buyers, newBuyer];
        setBuyers(updated);
        saveBuyers(updated);

        setNewRemark('');
        setNewCookie('');
    };

    const removeBuyer = (id: string) => {
        const updated = buyers.filter(b => b.id !== id);
        setBuyers(updated);
        saveBuyers(updated);
    };

    // Persist config settings
    useEffect(() => {
        localStorage.setItem('pullMode', pullMode);
        localStorage.setItem('productMode', productMode);
    }, [pullMode, productMode]);

    const saveSettings = async (duration: number) => {
        try {
            await fetch(getApiUrl('settings'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ validityDuration: duration })
            });
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">通道配置</h2>
                <p className="text-slate-500 text-sm">配置转转支付通道的拉单账号与策略</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Strategy Config */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800">
                        <Settings className="w-5 h-5 text-indigo-600" />
                        <span>策略设置</span>
                    </h3>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">拉单账号模式</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPullMode('random')}
                                    className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${pullMode === 'random' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    随机轮询
                                </button>
                                <button
                                    onClick={() => setPullMode('specific')}
                                    className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${pullMode === 'specific' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    指定账号
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                {pullMode === 'random' ? '每次拉单时从下方账号列表中随机选择一个。' : '需在支付页面手动选择一个账号进行拉单。'}
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">商品匹配模式</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setProductMode('random')}
                                    className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${productMode === 'random' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    全局随机
                                </button>
                                <button
                                    onClick={() => setProductMode('shop')}
                                    className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${productMode === 'shop' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    指定店铺
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                {productMode === 'random' ? '从所有店铺的空闲商品中随机选择。' : '先选择店铺，再从该店铺中随机选择空闲商品。'}
                            </p>
                            <p className="text-xs text-slate-400 mt-2">
                                {productMode === 'random' ? '从所有店铺的空闲商品中随机选择。' : '先选择店铺，再从该店铺中随机选择空闲商品。'}
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">订单有效时间 (秒)</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="number"
                                    className="w-24 px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={validityDuration}
                                    onChange={e => {
                                        const val = parseInt(e.target.value) || 60;
                                        setValidityDuration(val);
                                        saveSettings(val);
                                    }}
                                />
                                <span className="text-slate-500 text-sm">秒</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                支付链接生成后的有效时间，超时后订单将自动取消。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Add Account */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800 mb-4">
                        <Plus className="w-5 h-5 text-indigo-600" />
                        <span>添加拉单账号 (买家)</span>
                    </h3>
                    <form onSubmit={handleAddBuyer} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="md:col-span-1">
                                <input
                                    type="text"
                                    placeholder="账号备注"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                                    value={newRemark}
                                    onChange={e => setNewRemark(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="md:col-span-3">
                                <input
                                    type="text"
                                    placeholder="Cookie (zz_t, uid, etc.)"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono text-sm"
                                    value={newCookie}
                                    onChange={e => setNewCookie(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
                        >
                            <Save className="w-4 h-4" />
                            <span>保存账号</span>
                        </button>
                    </form>
                </div>
            </div>

            {/* Account List */}
            <h3 className="text-lg font-bold text-slate-800 mt-8">已配置账号列表 ({buyers.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {buyers.map(buyer => (
                    <div key={buyer.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-semibold text-slate-800 truncate">{buyer.remark}</h4>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span>成功数: {buyer.successOrders}</span>
                                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                    <span>总单数: {buyer.totalOrders}</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => removeBuyer(buyer.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                {buyers.length === 0 && (
                    <div className="col-span-full py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <User className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 text-sm">暂无拉单账号</p>
                    </div>
                )}
            </div>
        </div>
    );
};
