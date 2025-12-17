import React, { useState, useMemo } from 'react';
import { Order, OrderStatus, PaymentMethod } from '../types';
import {
    Search,
    Filter,
    Calendar,
    Download,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Eye,
    RefreshCw,
    XCircle
} from 'lucide-react';

interface OrderCenterProps {
    orders: Order[];
    onCancelOrder?: (order: Order) => Promise<void>;
    onCheckStatus?: (order: Order) => Promise<void>;
}

const ITEMS_PER_PAGE = 20;

export const OrderCenter: React.FC<OrderCenterProps> = ({ orders, onCancelOrder, onCheckStatus }) => {
    // Filters State
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('');
    const [methodFilter, setMethodFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);

    // Computed Filtered Data
    const filteredOrders = useMemo(() => {
        const filtered = orders.filter(order => {
            const matchesSearch =
                order.orderNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.id.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesDate = dateFilter ? order.createdAt.startsWith(dateFilter) : true;
            const matchesMethod = methodFilter !== 'all' ? order.method === methodFilter : true;
            const matchesStatus = statusFilter !== 'all' ? order.status === statusFilter : true;

            return matchesSearch && matchesDate && matchesMethod && matchesStatus;
        });

        // Sort by time descending (newest first)
        return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orders, searchTerm, dateFilter, methodFilter, statusFilter]);

    // Pagination Logic
    const totalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // Reset page when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, dateFilter, methodFilter, statusFilter]);

    const getStatusColor = (status: OrderStatus) => {
        switch (status) {
            case OrderStatus.SUCCESS: return 'bg-green-100 text-green-700 border-green-200';
            case OrderStatus.PENDING: return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case OrderStatus.FAILED: return 'bg-red-100 text-red-700 border-red-200';
            case OrderStatus.REFUNDED: return 'bg-slate-100 text-slate-700 border-slate-200';
            case OrderStatus.CANCELLED: return 'bg-gray-100 text-gray-500 border-gray-200';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">订单中心</h2>
                    <p className="text-slate-500 text-sm">管理和查看所有交易记录</p>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm">
                        <Download className="w-4 h-4" />
                        <span>导出 CSV</span>
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col lg:flex-row gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="搜索订单号 / ID..."
                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex gap-4">
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                            type="date"
                            className="pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600 w-44"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                        />
                    </div>

                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <select
                            className="pl-10 pr-8 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600 appearance-none bg-white min-w-[140px]"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">所有状态</option>
                            <option value={OrderStatus.SUCCESS}>已支付</option>
                            <option value={OrderStatus.PENDING}>未支付</option>
                            <option value={OrderStatus.CANCELLED}>已取消</option>
                            <option value={OrderStatus.REFUNDED}>已退款</option>
                        </select>
                    </div>

                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <select
                            className="pl-10 pr-8 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600 appearance-none bg-white min-w-[140px]"
                            value={methodFilter}
                            onChange={(e) => setMethodFilter(e.target.value)}
                        >
                            <option value="all">所有支付方式</option>
                            {Object.values(PaymentMethod).map(method => (
                                <option key={method} value={method}>{method}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-4 font-semibold text-slate-600 text-sm">内部订单号</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm">外部订单号</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm">金额</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm">支付方式</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm">状态</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm">创建时间</th>
                                <th className="p-4 font-semibold text-slate-600 text-sm text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedOrders.length > 0 ? (
                                paginatedOrders.map((order) => (
                                    <tr key={order.id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="p-4">
                                            <span className="font-mono text-slate-700 text-sm">{order.orderNo}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-slate-500 text-sm">{order.id}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className="font-semibold text-slate-800">{order.amount.toFixed(2)}元</span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-slate-700">默认通道</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 w-fit ${getStatusColor(order.status)}`}>
                                                {order.status === OrderStatus.CANCELLED && <XCircle className="w-3 h-3" />}
                                                {order.status === OrderStatus.REFUNDED && <RefreshCw className="w-3 h-3" />}
                                                {order.status === OrderStatus.SUCCESS ? '已支付' :
                                                    order.status === OrderStatus.PENDING ? '未支付' :
                                                        order.status === OrderStatus.CANCELLED ? '已取消' :
                                                            order.status === OrderStatus.REFUNDED ? '已退款' : order.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-slate-500">
                                            {new Date(order.createdAt).toLocaleString()}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {order.status === OrderStatus.PENDING && (
                                                    <button
                                                        className="p-1.5 hover:bg-red-100 rounded text-red-500 flex items-center gap-1 text-xs font-medium px-2 border border-transparent hover:border-red-200 transition-colors"
                                                        title="取消订单"
                                                        onClick={() => onCancelOrder && onCancelOrder(order)}
                                                    >
                                                        <XCircle className="w-3.5 h-3.5" />
                                                        取消
                                                    </button>
                                                )}
                                                <button
                                                    className="p-1.5 hover:bg-slate-200 rounded text-slate-500"
                                                    title="手动回调/查询状态"
                                                    onClick={() => onCheckStatus && onCheckStatus(order)}
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-slate-400">
                                        没有找到符合条件的订单
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                <div className="p-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50">
                    <span className="text-sm text-slate-500">
                        显示 {paginatedOrders.length} 条，共 {filteredOrders.length} 条记录
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-lg border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4 text-slate-600" />
                        </button>

                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            // Simple logic to show window of pages around current
                            let pNum = i + 1;
                            if (totalPages > 5 && currentPage > 3) {
                                pNum = currentPage - 3 + i + 1;
                                if (pNum > totalPages) pNum = totalPages - (4 - i);
                            }

                            return (
                                <button
                                    key={pNum}
                                    onClick={() => setCurrentPage(pNum)}
                                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${currentPage === pNum
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                                        }`}
                                >
                                    {pNum}
                                </button>
                            )
                        })}

                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="p-2 rounded-lg border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4 text-slate-600" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
