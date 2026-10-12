import { authorizeSales } from './sales-flow.mjs';
import { generateReportPdf } from './report-pdf.mjs';

export async function handleReportPdfRequest(request,env){
  const match=new URL(request.url).pathname.match(/^\/api\/sales\/([0-9a-f-]{36})\/pdf$/i);
  if(!match)return null;
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405});
  const order=await authorizeSales(env.DB,match[1],request.headers.get('x-diagnosis-token'));
  if(!order)return Response.json({error:'閲覧権限を確認できません。'},{status:403});
  if(order.payment_status!=='paid'||order.sales_stage!=='completed'||!order.report_json)return Response.json({error:'診断完了後に閲覧できます。'},{status:403});
  const pdf=generateReportPdf(JSON.parse(order.report_json));
  return new Response(pdf.bytes,{headers:{
    'content-type':'application/pdf',
    'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
    'cache-control':'private, no-store',
    'x-content-type-options':'nosniff'
  }});
}
