import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, PageNumber, ExternalHyperlink } from 'docx';
import type {Job,Paper} from './types';
export function reference(p:Paper,index:number):string {return `[${index+1}] ${p.authors.length?p.authors.slice(0,6).join(', ')+(p.authors.length>6?', et al.':''):'作者信息缺失'}. ${p.title}. ${p.journal||'期刊信息缺失'}, ${p.year||'年份缺失'}.${p.doi?` DOI: ${p.doi}`:''}${p.source.includes('arXiv')?' [arXiv preprint source; peer-review status not verified]':''}`;}
export function reviewDocument(job:Job):Document{
 const r=job.review;if(!r)throw new Error('Review not completed');const en=job.input.language==='en';
 const text=(s:string)=>new Paragraph({children:[new TextRun(s)],spacing:{after:180,line:360}});
 const heading=(s:string)=>new Paragraph({text:s,heading:HeadingLevel.HEADING_1,spacing:{before:300,after:160}});
 const doc=new Document({creator:'Paperleaf',title:r.title,styles:{default:{document:{run:{font:{ascii:'Calibri',eastAsia:'宋体',hAnsi:'Calibri'},size:24},paragraph:{spacing:{line:360}}}}},sections:[{properties:{page:{margin:{top:1440,right:1440,bottom:1440,left:1440}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:[PageNumber.CURRENT]})]})]})},children:[new Paragraph({text:r.title,heading:HeadingLevel.TITLE,alignment:AlignmentType.CENTER}),heading(en?'Abstract':'摘要'),text(r.abstract),text(`${en?'Keywords':'关键词'}: ${r.keywords.join(en?'; ':'；')}`),...r.sections.flatMap(s=>[heading(s.title),...s.paragraphs.map(p=>text(p.text+p.citations.map(id=>`[${job.papers.findIndex(x=>x.id===id)+1}]`).join('')))]),heading(en?'References':'参考文献'),...job.papers.map((p,i)=>new Paragraph({spacing:{after:160},children:[new TextRun(reference(p,i)+' '),new ExternalHyperlink({link:p.url,children:[new TextRun({text:en?'Source':'来源',style:'Hyperlink'})]})]})),heading(en?'Search and evidence notes':'检索与证据说明'),text(en?'AI-assisted narrative review draft. Verify sources and revise according to course requirements before submission. The abstract is extracted from the introduction.':'AI 辅助生成的叙述性综述初稿。请核对来源，并按课程要求修改后使用。摘要摘取自引言。'),...job.warnings.map(text)]}]});
 return doc;
}

export async function wordDocument(job:Job):Promise<Buffer>{return Packer.toBuffer(reviewDocument(job));}
