import React, { useMemo } from 'react';
import { Order, OrderStatus } from '../types';
import { 
  DollarSign, 
  ShoppingCart, 
  Activity, 
  TrendingUp, 
  TrendingDown,
  CreditCard
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

interface DashboardProps {
  orders: Order[];
}

export const Dashboard: React.FC<DashboardProps> = ({ orders }) => {
  // Calculate Stats
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Filter today's orders (simulated by checking if date matches today in local time)
    // For demo purposes, let's assume "Today" matches the latest date in our mock data if actual today has no data, 
    // but the mock generator creates data up to "now", so strictly checking today is fine.
    const todayOrders = orders.filter(o => o.createdAt.startsWith(todayStr));
    
    const todayCount = todayOrders.length;
    const todayAmount = todayOrders.reduce((sum, o) => o.status === OrderStatus.SUCCESS ? sum + o.amount : sum, 0);
    
    const totalSuccess = orders.filter(o => o.status === OrderStatus.SUCCESS).length;
    const successRate = orders.length > 0 ? (totalSuccess / orders.length) * 100 : 0;

    // Chart Data: Last 7 days
    const chartDataMap = new Map<string, { date: string; amount: number; count: number }>();
    
    // Initialize last 7 days
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        chartDataMap.set(dateKey, { date: dateKey.substring(5), amount: 0, count: 0 });
    }

    orders.forEach(o => {
      const dateKey = o.createdAt.split('T')[0];
      if (chartDataMap.has(dateKey) && o.status === OrderStatus.SUCCESS) {
        const entry = chartDataMap.get(dateKey)!;
        entry.amount += o.amount;
        entry.count += 1;
      }
    });

    return {
      todayCount,
      todayAmount,
      successRate,
      chartData: Array.from(chartDataMap.values())
    };
  }, [orders]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Stat Card 1 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <ShoppingCart className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">今日订单数</p>
            <h3 className="text-2xl font-bold text-slate-800">{stats.todayCount}</h3>
            <div className="flex items-center text-xs text-green-600 mt-1">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span>+12% 较昨日</span>
            </div>
          </div>
        </div>

        {/* Stat Card 2 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 rounded-lg">
            <DollarSign className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">今日交易额</p>
            <h3 className="text-2xl font-bold text-slate-800">${stats.todayAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
             <div className="flex items-center text-xs text-green-600 mt-1">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span>+5.2% 较昨日</span>
            </div>
          </div>
        </div>

        {/* Stat Card 3 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
          <div className="p-3 bg-indigo-50 rounded-lg">
            <Activity className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">支付成功率</p>
            <h3 className="text-2xl font-bold text-slate-800">{stats.successRate.toFixed(1)}%</h3>
             <div className="flex items-center text-xs text-slate-400 mt-1">
              <span>近7天平均值</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart Area */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">近7天交易趋势</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.chartData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#1e293b' }}
                />
                <Area type="monotone" dataKey="amount" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#colorAmount)" name="交易额" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mini Chart Area */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">订单量分析</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                   cursor={{fill: '#f8fafc'}}
                   contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="订单数" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

       <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-xl text-white flex justify-between items-center">
            <div>
                <h4 className="text-lg font-semibold mb-1">升级您的支付体验</h4>
                <p className="text-slate-300 text-sm">接入更多国际支付通道，提升30%转化率</p>
            </div>
            <button className="bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                查看通道
            </button>
       </div>
    </div>
  );
};
