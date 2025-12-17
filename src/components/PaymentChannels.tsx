import React from 'react';
import { Layers, Plus, ShieldCheck, Globe, CreditCard } from 'lucide-react';

export const PaymentChannels: React.FC = () => {
  return (
    <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">支付通道管理</h2>
                <p className="text-slate-500 text-sm">配置和管理您的支付网关</p>
            </div>
            <button className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                <Plus className="w-4 h-4" />
                <span>添加新通道</span>
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Active Channel Card */}
            <div className="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        已激活
                    </span>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mb-4">
                    <CreditCard className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Stripe Checkout</h3>
                <p className="text-sm text-slate-500 mb-4">国际信用卡支付，支持 Visa, Mastercard。</p>
                <div className="flex items-center gap-4 text-xs text-slate-400 mb-4">
                    <div className="flex items-center gap-1">
                        <Globe className="w-3 h-3" /> Global
                    </div>
                    <div className="flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> 3DS Secure
                    </div>
                </div>
                <div className="border-t border-slate-100 pt-4 flex gap-2">
                    <button className="flex-1 text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">配置</button>
                    <button className="flex-1 text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">日志</button>
                </div>
            </div>

            {/* Placeholder Card */}
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[240px] hover:border-indigo-300 hover:bg-indigo-50 transition-all cursor-pointer group">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Plus className="w-6 h-6 text-indigo-500" />
                </div>
                <h3 className="text-slate-800 font-medium mb-1">接入新通道</h3>
                <p className="text-slate-400 text-sm max-w-[200px]">支持支付宝、微信支付、PayPal 等更多本地化支付方式。</p>
            </div>
        </div>
        
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
             <Layers className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
             <div>
                 <h4 className="text-amber-800 font-medium text-sm">开发中功能</h4>
                 <p className="text-amber-700 text-sm mt-1">
                     更多高级通道配置功能正在开发中。目前请使用配置文件或联系技术支持进行手动集成。
                 </p>
             </div>
        </div>
    </div>
  );
};
