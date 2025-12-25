import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Copy, Check } from 'lucide-react';
import { PaymentPageConfig } from '../types';
import { getApiUrl } from '../config';

export const PaymentPages: React.FC = () => {
    const [pages, setPages] = useState<PaymentPageConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);

    // Form State
    const [title, setTitle] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [notice, setNotice] = useState('');

    // IP Limit State
    const [isOpen, setIsOpen] = useState(true);
    const [ipLimitTime, setIpLimitTime] = useState('');
    const [ipLimitCount, setIpLimitCount] = useState('');
    const [ipWhitelist, setIpWhitelist] = useState('');

    const fetchPages = async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiUrl('payment_pages'));
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setPages(data);
                else setPages([]); // Prepare for empty init
            }
        } catch (e) {
            console.error("Failed to fetch payment pages", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPages();
    }, []);

    const handleSave = async () => {
        if (!title) return alert('请输入标题');

        const pageId = editId || Date.now().toString();
        const existingPage = pages.find(p => p.id === pageId);

        const newPage: PaymentPageConfig = {
            id: pageId,
            title,
            channelId: 'default',
            minAmount: minAmount ? parseFloat(minAmount) : undefined,
            maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
            notice,
            isOpen,
            ipLimitTime: ipLimitTime ? parseFloat(ipLimitTime) : undefined,
            ipLimitCount: ipLimitCount ? parseInt(ipLimitCount) : undefined,
            ipWhitelist,
            createdAt: existingPage?.createdAt || Date.now()
        };

        let updatedPages;
        if (editId) {
            updatedPages = pages.map(p => p.id === editId ? newPage : p);
        } else {
            updatedPages = [...pages, newPage];
        }

        await fetch(getApiUrl('payment_pages'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedPages)
        });

        setPages(updatedPages);
        setShowAddModal(false);
        setEditId(null);
        resetForm();
    };

    const resetForm = () => {
        setTitle(''); setMinAmount(''); setMaxAmount(''); setNotice('');
        setIsOpen(true); setIpLimitTime(''); setIpLimitCount(''); setIpWhitelist('');
    };

    const handleEdit = (page: PaymentPageConfig) => {
        setEditId(page.id);
        setTitle(page.title);
        setMinAmount(page.minAmount?.toString() || '');
        setMaxAmount(page.maxAmount?.toString() || '');
        setNotice(page.notice || '');
        setIsOpen(page.isOpen !== false && page.isOpen !== 0); // Default true, treat 0 as false
        setIpLimitTime(page.ipLimitTime?.toString() || '');
        setIpLimitCount(page.ipLimitCount?.toString() || '');
        setIpWhitelist(page.ipWhitelist || '');
        setShowAddModal(true);
    };

    const toggleOpen = async (id: string) => {
        // v2.2.83: Handle numeric 0/1 from DB correctly for boolean toggle
        const updatedPages = pages.map(p => {
            if (p.id === id) {
                const current = (p.isOpen !== false && p.isOpen !== 0);
                return { ...p, isOpen: !current };
            }
            return p;
        });
        setPages(updatedPages);
        await fetch(getApiUrl('payment_pages'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedPages)
        });
    };

    const handleDelete = async (id: string) => {
        if (!confirm('确定删除此收款页吗？')) return;
        const updatedPages = pages.filter(p => p.id !== id);
        setPages(updatedPages);
        await fetch(getApiUrl('payment_pages'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedPages)
        });
    };

    const getLink = (id: string) => {
        // Construct absolute URL based on current location
        const baseUrl = window.location.origin;
        return `${baseUrl}/?pay=${id}`;
    };

    const copyLink = (link: string) => {
        navigator.clipboard.writeText(link);
        alert('链接已复制');
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">收款页管理</h2>
                    <p className="text-slate-500 text-sm">创建和管理对外的收款页面链接</p>
                </div>
                <button
                    onClick={() => { resetForm(); setEditId(null); setShowAddModal(true); }}
                    className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span>新增收款页</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pages.map(page => (
                    <div key={page.id} className={`bg-white p-6 rounded-xl border ${(page.isOpen === false || page.isOpen === 0) ? 'border-red-100 bg-red-50/10' : 'border-slate-200'} shadow-sm hover:shadow-md transition-shadow`}>
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-lg text-slate-800">{page.title}</h3>
                                    {(page.isOpen === false || page.isOpen === 0) && (
                                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">商家休息中</span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">ID: {page.id}</div>
                            </div>
                            <button onClick={() => handleDelete(page.id)} className="text-slate-400 hover:text-red-500">
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="mb-4 flex gap-2">
                            <button
                                onClick={() => handleEdit(page)}
                                className="text-xs border border-indigo-200 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                            >
                                编辑配置
                            </button>
                            <button
                                onClick={() => toggleOpen(page.id)}
                                className={`text-xs px-2 py-1 rounded transition-colors ${page.isOpen !== false && page.isOpen !== 0 ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                            >
                                {page.isOpen !== false && page.isOpen !== 0 ? '设为休息' : '开始营业'}
                            </button>
                        </div>

                        <div className="space-y-2 text-sm text-slate-600 mb-6">
                            <div className="flex justify-between">
                                <span>通道:</span>
                                <span className="font-medium">默认通道</span>
                            </div>
                            <div className="flex justify-between">
                                <span>限额:</span>
                                <span className="font-medium">
                                    {page.minAmount || 0} - {page.maxAmount || '不限'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>频率限制:</span>
                                <span className="font-medium">
                                    {page.ipLimitTime && page.ipLimitCount ? `${page.ipLimitTime}小时/${page.ipLimitCount}次` : '无限制'}
                                </span>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 flex items-center gap-2">
                            <input
                                type="text"
                                readOnly
                                value={getLink(page.id)}
                                className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-500"
                            />
                            <button
                                onClick={() => copyLink(getLink(page.id))}
                                className="p-1.5 hover:bg-slate-100 rounded text-indigo-600"
                                title="复制链接"
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                            <a
                                href={getLink(page.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
                                title="打开"
                            >
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4 my-8">
                        <h3 className="text-xl font-bold text-slate-800">{editId ? '编辑收款页' : '新增收款页'}</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-1">页面标题</label>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="例如：VIP充值"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">最小金额</label>
                                <input
                                    type="number"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={minAmount}
                                    onChange={e => setMinAmount(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">最大金额</label>
                                <input
                                    type="number"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={maxAmount}
                                    onChange={e => setMaxAmount(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <h4 className="text-sm font-bold text-slate-800 mb-3">安全与营业设置</h4>
                            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg mb-4">
                                <span className="text-sm font-medium">当前营业状态</span>
                                <button
                                    onClick={() => setIsOpen(!isOpen)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isOpen ? 'bg-green-500' : 'bg-slate-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isOpen ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">频率检查时间 (小时)</label>
                                    <input
                                        type="number"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm"
                                        placeholder="例如: 1"
                                        value={ipLimitTime}
                                        onChange={e => setIpLimitTime(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">允许付款次数 (次)</label>
                                    <input
                                        type="number"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm"
                                        placeholder="例如: 3"
                                        value={ipLimitCount}
                                        onChange={e => setIpLimitCount(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">IP 白名单 (不受限制，逗号隔开)</label>
                                <textarea
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 h-16 text-sm"
                                    placeholder="127.0.0.1, 192.168.1.1"
                                    value={ipWhitelist}
                                    onChange={e => setIpWhitelist(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">页面注意事项 / 休息提示</label>
                            <textarea
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 h-20 text-sm"
                                placeholder="填写显示在支付页面的提示信息..."
                                value={notice}
                                onChange={e => setNotice(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                            >
                                {editId ? '保存修改' : '确认创建'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
