import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, User, Settings, Info, Edit, X, MapPin, Loader2, CheckCircle } from 'lucide-react';
import { BuyerAccount } from '../types';
import { getApiUrl, PROXY_URL } from '../config';

export const PaymentConfig: React.FC = () => {
    const [buyers, setBuyers] = useState<BuyerAccount[]>([]);

    // New Buyer Form
    const [newRemark, setNewRemark] = useState('');
    const [newCookie, setNewCookie] = useState('');

    // Editing State
    const [editingBuyer, setEditingBuyer] = useState<BuyerAccount | null>(null);
    const [editRemark, setEditRemark] = useState('');
    const [editCookie, setEditCookie] = useState('');
    const [editAddressId, setEditAddressId] = useState('');
    const [editAddressName, setEditAddressName] = useState('');
    const [fetchingAddr, setFetchingAddr] = useState(false);
    const [addressList, setAddressList] = useState<any[]>([]);

    // Config State
    const [pullMode, setPullMode] = useState<'specific' | 'random'>('random');
    const [productMode, setProductMode] = useState<'shop' | 'random'>('random');
    const [validityDuration, setValidityDuration] = useState<number>(180);
    const [specificBuyerId, setSpecificBuyerId] = useState<string>('');
    const [specificShopId, setSpecificShopId] = useState<string>('');
    const [shops, setShops] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Fetch System Settings
        fetch(getApiUrl('settings'))
            .then(res => res.json())
            .then(data => {
                if (data.validityDuration) setValidityDuration(Number(data.validityDuration));
                if (data.pullMode) setPullMode(data.pullMode);
                if (data.productMode) setProductMode(data.productMode);
                if (data.specificBuyerId) setSpecificBuyerId(data.specificBuyerId);
                if (data.specificShopId) setSpecificShopId(data.specificShopId);
            })
            .catch(console.error);

        fetch(getApiUrl('shops'))
            .then(res => res.json())
            .then(data => Array.isArray(data) && setShops(data))
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
        if (!window.confirm('确定要删除该账号吗？')) return;
        const updated = buyers.filter(b => b.id !== id);
        setBuyers(updated);
        saveBuyers(updated);
    };

    // Edit Logic
    const openEdit = (buyer: BuyerAccount) => {
        setEditingBuyer(buyer);
        setEditRemark(buyer.remark);
        setEditCookie(buyer.cookie);
        setEditAddressId(buyer.addressId || '');
        setEditAddressName(buyer.addressName || '');
        setAddressList([]);
    };

    const closeEdit = () => {
        setEditingBuyer(null);
        setAddressList([]);
    };

    const fetchAddresses = async () => {
        if (!editCookie) return alert('请先填写 Cookie');
        setFetchingAddr(true);
        setAddressList([]);
        try {
            const res = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: `https://app.zhuanzhuan.com/zz/transfer/getAllAddress?_t=${Date.now()}`,
                    cookie: editCookie,
                    method: 'GET'
                })
            });
            const data = await res.json();
            if (data.respCode === '0' && Array.isArray(data.respData)) {
                setAddressList(data.respData);
                if (data.respData.length === 0) alert('该账号未查询到收货地址');
            } else {
                alert('地址获取失败: ' + (data.errorMsg || 'Unknown Error'));
            }
        } catch (e) {
            console.error(e);
            alert('请求失败，请检查网络');
        } finally {
            setFetchingAddr(false);
        }
    };

    const saveEdit = () => {
        if (!editingBuyer) return;
        const updated = buyers.map(b => b.id === editingBuyer.id ? {
            ...b,
            remark: editRemark,
            cookie: editCookie,
            addressId: editAddressId,
            addressName: editAddressName
        } : b);
        setBuyers(updated);
        saveBuyers(updated);
        closeEdit();
    };


    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await fetch(getApiUrl('settings'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    validityDuration,
                    pullMode,
                    productMode,
                    specificBuyerId,
                    specificShopId
                })
            });
            alert('策略配置已保存');
        } catch (e) {
            console.error(e);
            alert('保存失败，请检查网络');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 relative">
            {/* Edit Modal */}
            {editingBuyer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
                            <h3 className="text-xl font-bold text-slate-800">编辑拉单账号</h3>
                            <button onClick={closeEdit} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">备注名称</label>
                                <input
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={editRemark}
                                    onChange={e => setEditRemark(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Cookie</label>
                                <textarea
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs h-24"
                                    value={editCookie}
                                    onChange={e => setEditCookie(e.target.value)}
                                />
                            </div>

                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <h4 className="font-bold text-slate-800 flex items-center gap-2">
                                            <MapPin className="w-4 h-4 text-indigo-600" />
                                            <span>固定收货地址 (可选)</span>
                                        </h4>
                                        <p className="text-xs text-slate-500 mt-1">设置后将直接使用该地址ID，不再重复请求地址接口</p>
                                    </div>
                                    <button
                                        onClick={fetchAddresses}
                                        disabled={fetchingAddr}
                                        className="bg-white border border-slate-300 hover:bg-indigo-50 hover:text-indigo-600 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm"
                                    >
                                        {fetchingAddr ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                                        <span>读取地址列表</span>
                                    </button>
                                </div>

                                {editAddressId && (
                                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-100 mb-4">
                                        <CheckCircle className="w-4 h-4" />
                                        <span>当前已绑定地址: {editAddressName || editAddressId}</span>
                                        <button onClick={() => { setEditAddressId(''); setEditAddressName(''); }} className="text-xs underline text-green-800 ml-auto">清除</button>
                                    </div>
                                )}

                                {addressList.length > 0 && (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {addressList.map((addr: any) => (
                                            <div
                                                key={addr.id}
                                                onClick={() => {
                                                    setEditAddressId(addr.id);
                                                    setEditAddressName(`${addr.name} ${addr.mobile} ${addr.address}`);
                                                }}
                                                className={`p-3 rounded-lg border cursor-pointer border-slate-200 hover:border-indigo-500 transition-all ${editAddressId === addr.id ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white'}`}
                                            >
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-sm text-slate-800">{addr.name} {addr.mobile}</span>
                                                    {addr.isDefault === '1' && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded">默认</span>}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1 truncate">{addr.address}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 sticky bottom-0 bg-white">
                            <button onClick={closeEdit} className="px-5 py-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">取消</button>
                            <button onClick={saveEdit} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg shadow-indigo-200 transition-colors">保存更改</button>
                        </div>
                    </div>
                </div>
            )}

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
                                {pullMode === 'random' ? '每次拉单时从下方账号列表中随机选择一个。' : '需在此指定一个默认使用的拉单账号。'}
                            </p>
                            {pullMode === 'specific' && (
                                <div className="mt-2">
                                    <select
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={specificBuyerId}
                                        onChange={e => setSpecificBuyerId(e.target.value)}
                                    >
                                        <option value="">-- 请选择拉单账号 --</option>
                                        {buyers.map(b => (
                                            <option key={b.id} value={b.id}>{b.remark}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
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
                                {productMode === 'random' ? '从所有店铺的空闲商品中随机选择。' : '仅使用下方指定店铺的库存。'}
                            </p>
                            {productMode === 'shop' && (
                                <div className="mt-2">
                                    <select
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={specificShopId}
                                        onChange={e => setSpecificShopId(e.target.value)}
                                    >
                                        <option value="">-- 请选择店铺 --</option>
                                        {shops.map(s => (
                                            <option key={s.id} value={s.id}>{s.name || `店铺 ${s.id.substr(0, 8)}`}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
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
                                        // saveSettings(val); // Removed auto-save
                                    }}
                                />
                                <span className="text-slate-500 text-sm">秒</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                支付链接生成后的有效时间，超时后订单将自动取消。
                            </p>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <button
                                onClick={handleSaveSettings}
                                disabled={saving}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <Save className="w-5 h-5" />
                                <span>{saving ? '保存中...' : '保存策略配置'}</span>
                            </button>
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
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => openEdit(buyer)}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                                title="编辑/设置地址"
                            >
                                <Edit className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => removeBuyer(buyer.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-colors"
                                title="删除账号"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
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
