import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import './styles.css';
import zhCN from 'antd/locale/zh_CN';
import { ConfigProvider } from 'antd';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      getPopupContainer={(trigger) => trigger?.parentElement || document.body}
      theme={{
        token: {
          colorPrimary: '#087f68',
          borderRadius: 10,
          controlHeight: 40,
          motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          colorBgLayout: '#f5f7f7',
          colorBgContainer: '#ffffff'
        }
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
