import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Copy, Check } from 'lucide-react';
import { PaymentPageConfig } from '../types';
import { getApiUrl } from '../config';

export const PaymentPages: React.FC = () => {
    const [pages, setPages] = useState<PaymentPageConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [title, setTitle] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');

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

        const newPage: PaymentPageConfig = {
            id: Date.now().toString(),
            title,
            channelId: 'default',
            minAmount: minAmount ? parseFloat(minAmount) : undefined,
            maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
            createdAt: Date.now()
        };

        const updatedPages = [...pages, newPage];

        await fetch(getApiUrl('payment_pages'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedPages)
        });

        setPages(updatedPages);
        setShowAddModal(false);
        setTitle(''); setMinAmount(''); setMaxAmount('');
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
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span>新增收款页</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pages.map(page => (
                    <div key={page.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800">{page.title}</h3>
                                <div className="text-xs text-slate-500 mt-1">ID: {page.id}</div>
                            </div>
                            <button onClick={() => handleDelete(page.id)} className="text-slate-400 hover:text-red-500">
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-2 text-sm text-slate-600 mb-6">
                            <div className="flex justify-between">
                                <span>通道:</span>
                                <span className="font-medium">默认通道 (自动凑整8)</span>
                            </div>
                            <div className="flex justify-between">
                                <span>限额:</span>
                                <span className="font-medium">
                                    {page.minAmount || 0} - {page.maxAmount || '不限'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>创建时间:</span>
                                <span>{new Date(page.createdAt).toLocaleDateString()}</span>
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
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
                        <h3 className="text-xl font-bold text-slate-800">新增收款页</h3>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">页面标题 (展示给用户)</label>
                            <input
                                type="text"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="例如：VIP充值"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
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

                        <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
                            说明：当前使用默认通道，所有输入金额将自动向下取整到以 8 结尾（例如 513 → 508）。
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
                                确认创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
