import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Paperleaf · 文献综述，从这里开始',description:'输入研究主题，检索真实文献，生成有据可循的综述初稿并下载 Word。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
